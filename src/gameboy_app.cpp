#include "gameboy_app.h"
#include "rom_store.h"
#include "gb_video.h"
#include <LittleFS.h>
#include <esp_heap_caps.h>
#include <setjmp.h>
#include <freertos/semphr.h>
#define ENABLE_SOUND 0
#define PEANUT_GB_12_COLOUR 0
#include <peanut_gb.h>

namespace {
gb_s core;
uint8_t* rom = nullptr;
uint8_t* ram = nullptr;
uint8_t* sourceBuffers[3] = {};
uint8_t* presented = nullptr;
uint16_t* stripes[2] = {};
gbvideo::Mailbox mailbox;
gbvideo::Scaler scaler;
portMUX_TYPE mailboxMux = portMUX_INITIALIZER_UNLOCKED;
bool presentedValid = false, dmaEnabled = false;
SemaphoreHandle_t renderMutex = nullptr;
SemaphoreHandle_t frameAvailable = nullptr;
TaskHandle_t renderTask = nullptr;
bool drawingEnabled = false;
struct VideoCounters {
  uint32_t displayed = 0, consumed = 0, replaced = 0, rectangles = 0;
  uint64_t bytes = 0, renderUs = 0, transferUs = 0;
} video;
String romName;
size_t romSize = 0, ramSize = 0;
bool dirty = false;
jmp_buf failure;
int errorCode = 0;
uint16_t errorAddress = 0;

uint8_t readRom(gb_s*, uint_fast32_t address) { return address < romSize ? rom[address] : 0xFF; }
uint8_t readRam(gb_s*, uint_fast32_t address) { return address < ramSize ? ram[address] : 0xFF; }
void writeRam(gb_s*, uint_fast32_t address, uint8_t value) {
  if (address < ramSize && ram[address] != value) { ram[address] = value; dirty = true; }
}
void fail(gb_s*, gb_error_e code, uint16_t address) {
  errorCode = code; errorAddress = address;
  longjmp(failure, 1);
}
void drawLine(gb_s*, const uint8_t* line, uint_fast8_t y) {
  if (y >= gbvideo::sourceHeight) return;
  uint8_t* output = mailbox.writing() + y * gbvideo::sourceWidth;
  for (int x = 0; x < gbvideo::sourceWidth; ++x) output[x] = line[x] & 3;
}

VideoCounters counters() {
  portENTER_CRITICAL(&mailboxMux);
  VideoCounters copy = video;
  portEXIT_CRITICAL(&mailboxMux);
  return copy;
}

void renderLoop(void* context) {
  auto& display = *static_cast<TFT_eSPI*>(context);
  for (;;) {
    xSemaphoreTake(frameAvailable, portMAX_DELAY);
    xSemaphoreTake(renderMutex, portMAX_DELAY);
    const uint8_t* frame = nullptr;
    if (drawingEnabled) {
      portENTER_CRITICAL(&mailboxMux);
      frame = mailbox.consume();
      portEXIT_CRITICAL(&mailboxMux);
    }
    if (frame) {
      const uint32_t renderAt = micros();
      const auto damage = gbvideo::findDamage(frame, presented, presentedValid);
      const bool swap = display.getSwapBytes();
      // Keep the original working TFT_eSPI writer/byte-order path when DMA
      // is disabled. DMA needs wire-order pixels; normal pushImage swaps them.
      display.setSwapBytes(!dmaEnabled);
      uint32_t bytes = 0, transferUs = 0;
      int buffer = 0;
      if (damage.count) display.startWrite();
      for (size_t i = 0; i < damage.count; ++i) {
        const auto rect = gbvideo::destination(damage.rects[i]);
        for (int y = rect.y; y < rect.y + rect.h; y += gbvideo::stripeRows) {
          const int rows = std::min(gbvideo::stripeRows, int(rect.y + rect.h - y));
          // Fill one internal-RAM stripe while DMA sends the other. Neither
          // the renderer nor SPI ever owns the emulator's writable buffer.
          scaler.stripe(frame, rect.x, y, rect.w, rows, stripes[buffer], dmaEnabled);
          const uint32_t transferAt = micros();
          if (dmaEnabled) {
            display.dmaWait();
            display.pushImageDMA(gbvideo::offsetX + rect.x, y, rect.w, rows, stripes[buffer]);
          } else display.pushImage(gbvideo::offsetX + rect.x, y, rect.w, rows, stripes[buffer]);
          transferUs += uint32_t(micros() - transferAt);
          bytes += rect.w * rows * 2;
          buffer ^= 1;
        }
      }
      if (dmaEnabled) {
        const uint32_t transferAt = micros(); display.dmaWait();
        transferUs += uint32_t(micros() - transferAt);
      }
      if (damage.count) display.endWrite();
      display.setSwapBytes(swap);
      // Only this completed LCD image is used for future damage comparisons
      // and screenshots. Comparing against a dropped frame leaves stale pixels.
      memcpy(presented, frame, gbvideo::frameBytes); presentedValid = true;
      portENTER_CRITICAL(&mailboxMux);
      ++video.consumed;
      if (damage.count) ++video.displayed;
      video.rectangles += damage.count; video.bytes += bytes;
      video.renderUs += uint32_t(micros() - renderAt); video.transferUs += transferUs;
      portEXIT_CRITICAL(&mailboxMux);
    }
    xSemaphoreGive(renderMutex);
  }
}

bool beginRenderer(TFT_eSPI& display) {
  if (renderTask) return true;
#if defined(ROBOT_GB_DMA) && ROBOT_GB_DMA && defined(ESP32_DMA) && !defined(SPI_18BIT_DRIVER)
  // Experimental opt-in: framebuffer screenshots cannot verify DMA output on
  // the physical panel. Use the normal SPI writer for the default firmware.
  dmaEnabled = display.DMA_Enabled || display.initDMA(false);
#endif
  renderMutex = xSemaphoreCreateMutex();
  frameAvailable = xSemaphoreCreateBinary();
  if (renderMutex && frameAvailable &&
      xTaskCreatePinnedToCore(renderLoop, "gb-display", 6144, &display, 1,
                              &renderTask, 0) == pdPASS) return true;
  if (renderMutex) vSemaphoreDelete(renderMutex);
  if (frameAvailable) vSemaphoreDelete(frameAvailable);
  renderMutex = frameAvailable = nullptr;
  renderTask = nullptr;
  return false;
}

void release() {
  if (renderMutex) xSemaphoreTake(renderMutex, portMAX_DELAY);
  drawingEnabled = false;
  portENTER_CRITICAL(&mailboxMux);
  mailbox.reset();
  portEXIT_CRITICAL(&mailboxMux);
  free(rom); free(ram); free(presented);
  for (auto& buffer : sourceBuffers) { free(buffer); buffer = nullptr; }
  for (auto& stripe : stripes) { free(stripe); stripe = nullptr; }
  rom = ram = presented = nullptr; presentedValid = false;
  romSize = ramSize = 0;
  if (frameAvailable) xSemaphoreTake(frameAvailable, 0);
  if (renderMutex) xSemaphoreGive(renderMutex);
}
}

bool GameBoyApp::start(const String& name) {
  if (active_) return false;
  error_ = "";
  File file = LittleFS.open("/roms/" + name, "r");
  error_ = roms::validate(file);
  if (!error_.isEmpty()) return false;
  if (!beginRenderer(display_)) { error_ = "Не удалось запустить экран игры"; return false; }
  romSize = file.size();
  rom = static_cast<uint8_t*>(heap_caps_malloc(romSize, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
  bool allocated = rom != nullptr;
  for (auto& buffer : sourceBuffers) {
    buffer = static_cast<uint8_t*>(heap_caps_malloc(gbvideo::frameBytes, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT));
    if (!buffer) buffer = static_cast<uint8_t*>(heap_caps_malloc(gbvideo::frameBytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
    allocated = allocated && buffer != nullptr;
  }
  presented = static_cast<uint8_t*>(heap_caps_malloc(gbvideo::frameBytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
  for (auto& stripe : stripes) {
    stripe = static_cast<uint16_t*>(heap_caps_malloc(gbvideo::width * gbvideo::stripeRows * 2,
                                                    MALLOC_CAP_DMA | MALLOC_CAP_INTERNAL));
    allocated = allocated && stripe != nullptr;
  }
  if (!allocated || !presented) {
    error_ = "Не хватает памяти для игры"; release(); return false;
  }
  if (file.read(rom, romSize) != romSize) { error_ = "Ошибка чтения игры"; release(); return false; }
  file.close();
  memset(&core, 0, sizeof(core));
  const auto result = gb_init(&core, readRom, readRam, writeRam, fail, nullptr);
  if (result != GB_INIT_NO_ERROR || gb_get_save_size_s(&core, &ramSize) != 0) {
    error_ = "Картридж не поддерживается"; release(); return false;
  }
  if (ramSize) {
    ram = static_cast<uint8_t*>(heap_caps_malloc(ramSize, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
    if (!ram) { error_ = "Не хватает памяти сохранения"; release(); return false; }
    memset(ram, 0xFF, ramSize);
  }
  savePath_ = "/saves/" + name + ".sav";
  File saved;
  if (LittleFS.exists(savePath_)) saved = LittleFS.open(savePath_, "r");
  if (saved && saved.size() == ramSize && ramSize) {
    if (saved.read(ram, ramSize) != ramSize) {
      error_ = "Ошибка чтения сохранения"; release(); return false;
    }
    Serial.printf("GAMEBOY: loaded save bytes=%u\n", unsigned(ramSize));
  }
  saved.close();
  for (auto buffer : sourceBuffers) memset(buffer, 0, gbvideo::frameBytes);
  memset(presented, 0, gbvideo::frameBytes);
  portENTER_CRITICAL(&mailboxMux);
  mailbox.reset(sourceBuffers[0], sourceBuffers[1], sourceBuffers[2]);
  video = VideoCounters{};
  portEXIT_CRITICAL(&mailboxMux);
  romName = name;
  gb_init_lcd(&core, drawLine);
  time_t timestamp = time(nullptr);
  if (timestamp > 1600000000) { tm clock; localtime_r(&timestamp, &clock); gb_set_rtc(&core, &clock); }
  dirty = false; active_ = true; frames_ = 0; emulationUs_ = 0;
  startFrames_ = selectFrames_ = 0;
  savedAt_ = millis();
  resume();
  Serial.printf("GAMEBOY: started %s rom=%u ram=%u\n", name.c_str(), unsigned(romSize), unsigned(ramSize));
  return true;
}

bool GameBoyApp::save() {
  if (!active_ || !dirty || !ramSize) return true;
  const String temporary = savePath_ + ".tmp";
  File file = LittleFS.open(temporary, "w");
  bool written = file && file.write(ram, ramSize) == ramSize;
  file.close();
  if (!written || !LittleFS.rename(temporary, savePath_)) {
    LittleFS.remove(temporary);
    error_ = "Не удалось сохранить игру";
    return false;
  }
  dirty = false;
  savedAt_ = millis();
  Serial.printf("GAMEBOY: saved bytes=%u\n", unsigned(ramSize));
  return true;
}

bool GameBoyApp::stop() {
  if (!save()) return false;
  pause();
  active_ = false; release();
  return true;
}

void GameBoyApp::resume() {
  if (!active_) return;
  pause();
  xSemaphoreTake(renderMutex, portMAX_DELAY);
  display_.fillScreen(TFT_BLACK);
  presentedValid = false;
  drawingEnabled = true;
  xSemaphoreGive(renderMutex);
  nextFrame_ = micros();
  sampleAt_ = millis(); sampleFrames_ = frames_; sampleDisplayed_ = counters().displayed;
}

void GameBoyApp::pause() {
  if (!renderMutex) return;
  // Wait for any in-flight SPI transfer before the shell draws over the game.
  xSemaphoreTake(renderMutex, portMAX_DELAY);
  drawingEnabled = false;
  xSemaphoreTake(frameAvailable, 0);
  portENTER_CRITICAL(&mailboxMux);
  mailbox.discard();
  portEXIT_CRITICAL(&mailboxMux);
  xSemaphoreGive(renderMutex);
}

void GameBoyApp::update(const Controls& controls) {
  if (!active_) return;
  uint8_t keys = 0xFF;
  if (controls.aDown) keys &= ~JOYPAD_A;
  if (controls.bDown) keys &= ~JOYPAD_B;
  if (controls.x > 0.45f) keys &= ~JOYPAD_RIGHT;
  if (controls.x < -0.45f) keys &= ~JOYPAD_LEFT;
  if (controls.y > 0.45f) keys &= ~JOYPAD_DOWN;
  if (controls.y < -0.45f) keys &= ~JOYPAD_UP;
  if (setjmp(failure)) {
    error_ = "Ошибка игры: " + String(errorCode) + " / " + String(errorAddress, HEX);
    Serial.println(error_);
    // Keep RAM allocated until the shell saves and closes the cartridge.
    return;
  }
  for (int step = 0; step < 4 && int32_t(micros() - nextFrame_) >= 0; ++step) {
    core.direct.joypad = keys;
    if (startFrames_) { core.direct.joypad &= ~JOYPAD_START; --startFrames_; }
    if (selectFrames_) { core.direct.joypad &= ~JOYPAD_SELECT; --selectFrames_; }
    const uint32_t frameAt = micros();
    gb_run_frame(&core);
    emulationUs_ += uint32_t(micros() - frameAt);
    nextFrame_ += 16743;
    ++frames_;
    const uint8_t* completed = mailbox.writing();
    portENTER_CRITICAL(&mailboxMux);
    if (mailbox.publish()) ++video.replaced;
    portEXIT_CRITICAL(&mailboxMux);
    // Preserve the complete image even if the LCD is disabled or only some
    // scanlines are produced by the next emulated frame.
    memcpy(mailbox.writing(), completed, gbvideo::frameBytes);
    xSemaphoreGive(frameAvailable);
  }
  // Bound catch-up after a slow flash operation to keep controls responsive.
  if (int32_t(micros() - nextFrame_) > 100000) nextFrame_ = micros();
  const uint32_t now = millis();
  if (uint32_t(now - savedAt_) >= 30000) { save(); savedAt_ = now; }
}

void GameBoyApp::screenshot() {
  if (!active_) return;
  xSemaphoreTake(renderMutex, portMAX_DELAY);
  Serial.print("P6\n320 240\n255\n");
  uint8_t row[960];
  for (int y = 0; y < 240; ++y) {
    for (int x = 0; x < 320; ++x) {
      uint16_t c = (presentedValid && x >= gbvideo::offsetX && x < gbvideo::offsetX + gbvideo::width)
                       ? scaler.pixel(presented, x - gbvideo::offsetX, y) : TFT_BLACK;
      row[x * 3] = ((c >> 11) & 31) * 255 / 31;
      row[x * 3 + 1] = ((c >> 5) & 63) * 255 / 63;
      row[x * 3 + 2] = (c & 31) * 255 / 31;
    }
    Serial.write(row, sizeof(row));
  }
  xSemaphoreGive(renderMutex);
}

void GameBoyApp::printVideoStatus() const {
  if (!active_) return;
  const auto stats = counters();
  const uint32_t now = millis(), elapsed = now - sampleAt_;
  const float emuFps = elapsed ? (frames_ - sampleFrames_) * 1000.0f / elapsed : 0;
  const float lcdFps = elapsed ? (stats.displayed - sampleDisplayed_) * 1000.0f / elapsed : 0;
  Serial.printf("GAMEBOY_VIDEO: rom=%s source=160x144 output=%dx%d offset=%d,0 displayed=%u consumed=%u replaced=%u dma=%d spi_hz=%u emu_fps=%.1f lcd_fps=%.1f emu_us=%u render_us=%u spi_us=%u bytes=%llu rects=%u\n",
                romName.c_str(), gbvideo::width, gbvideo::height, gbvideo::offsetX, stats.displayed,
                stats.consumed, stats.replaced, dmaEnabled, unsigned(SPI_FREQUENCY), emuFps, lcdFps,
                unsigned(frames_ ? emulationUs_ / frames_ : 0),
                unsigned(stats.consumed ? stats.renderUs / stats.consumed : 0),
                unsigned(stats.consumed ? stats.transferUs / stats.consumed : 0),
                static_cast<unsigned long long>(stats.bytes), stats.rectangles);
  sampleAt_ = now; sampleFrames_ = frames_; sampleDisplayed_ = stats.displayed;
}
