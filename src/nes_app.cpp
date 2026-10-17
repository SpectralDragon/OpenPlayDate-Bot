#include "nes_app.h"
#include "nes_store.h"
#include "nes_video.h"
#include <LittleFS.h>
#include <esp_heap_caps.h>
#include <freertos/semphr.h>
extern "C" {
#include <nes/nes.h>
}
#include <palettes.h>

namespace {
nes_t* core = nullptr;
uint8_t *romBytes = nullptr, *savedRam = nullptr, *presented = nullptr;
uint8_t* buffers[3] = {};
uint16_t* stripeBuffer = nullptr;
uint16_t colors[64];
size_t ramBytes = 0;
nesvideo::Mailbox mailbox;
portMUX_TYPE mailboxMux = portMUX_INITIALIZER_UNLOCKED;
SemaphoreHandle_t renderMutex = nullptr, frameAvailable = nullptr;
TaskHandle_t renderTask = nullptr;
bool drawing = false, presentedValid = false;
uint32_t displayed = 0, replaced = 0;

void renderLoop(void* context) {
  auto& display = *static_cast<TFT_eSPI*>(context);
  for (;;) {
    xSemaphoreTake(frameAvailable, portMAX_DELAY);
    xSemaphoreTake(renderMutex, portMAX_DELAY);
    const uint8_t* frame = nullptr;
    if (drawing) {
      portENTER_CRITICAL(&mailboxMux);
      frame = mailbox.consume();
      portEXIT_CRITICAL(&mailboxMux);
    }
    if (frame) {
      const auto damage = nesvideo::findDamage(frame, presented, presentedValid);
      const bool swap = display.getSwapBytes();
      display.setSwapBytes(true);
      if (damage.count) display.startWrite();
      for (size_t i = 0; i < damage.count; ++i) {
        const auto& rect = damage.rects[i];
        nesvideo::stripe(frame, rect, colors, stripeBuffer);
        display.pushImage(rect.x, rect.y, rect.w, rect.h, stripeBuffer);
      }
      if (damage.count) { display.endWrite(); ++displayed; }
      display.setSwapBytes(swap);
      memcpy(presented, frame, nesvideo::frameBytes);
      presentedValid = true;
    }
    xSemaphoreGive(renderMutex);
  }
}

bool beginRenderer(TFT_eSPI& display) {
  if (renderTask) return true;
  renderMutex = xSemaphoreCreateMutex();
  frameAvailable = xSemaphoreCreateBinary();
  if (renderMutex && frameAvailable &&
      xTaskCreatePinnedToCore(renderLoop, "nes-display", 4096, &display, 1, &renderTask, 0) == pdPASS) return true;
  if (renderMutex) vSemaphoreDelete(renderMutex);
  if (frameAvailable) vSemaphoreDelete(frameAvailable);
  renderMutex = frameAvailable = nullptr; renderTask = nullptr;
  return false;
}

void release() {
  if (renderMutex) xSemaphoreTake(renderMutex, portMAX_DELAY);
  drawing = false;
  portENTER_CRITICAL(&mailboxMux);
  mailbox.reset();
  portEXIT_CRITICAL(&mailboxMux);
  if (core) nes_shutdown();
  core = nullptr;
  free(romBytes); free(savedRam); free(presented); free(stripeBuffer);
  romBytes = savedRam = presented = nullptr; stripeBuffer = nullptr;
  for (auto& buffer : buffers) { free(buffer); buffer = nullptr; }
  ramBytes = 0; presentedValid = false;
  if (frameAvailable) xSemaphoreTake(frameAvailable, 0);
  if (renderMutex) xSemaphoreGive(renderMutex);
}

uint8_t* psram(size_t bytes) {
  return static_cast<uint8_t*>(heap_caps_malloc(bytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
}
}

bool NesApp::start(const String& name) {
  if (active_) return false;
  error_ = "";
  if (nesroms::safeName(name) != name) { error_ = "Неверное имя NES ROM"; return false; }
  File file = LittleFS.open("/nes/" + name, "r");
  error_ = nesroms::validate(file);
  if (!error_.isEmpty()) return false;
  const size_t size = file.size();
  romBytes = psram(size);
  if (!romBytes) { error_ = "Не хватает памяти для NES ROM"; return false; }
  if (file.read(romBytes, size) != size) { error_ = "Ошибка чтения NES ROM"; release(); return false; }
  file.close();
  nescartridge::Header header;
  const char* invalid = nescartridge::parse(romBytes, size, header);
  if (invalid) { error_ = invalid; release(); return false; }
  core = nes_init(header.pal ? SYS_NES_PAL : SYS_NES_NTSC, 11025, false, nullptr);
  if (!core) { error_ = "Не хватает памяти для NES"; release(); return false; }
  rom_t* cart = rom_loadmem(romBytes, size);
  if (!cart || nes_insertcart(cart) != 0) {
    error_ = "Не удалось запустить картридж NES"; release(); return false;
  }
  // nes_insertcart resets RAM; restore battery RAM only after that reset.
  ramBytes = cart->battery ? cart->prg_ram_banks * ROM_PRG_BANK_SIZE : 0;
  savePath_ = "/saves/" + name + ".sav";
  if (ramBytes) {
    savedRam = psram(ramBytes);
    if (!savedRam) { error_ = "Не хватает памяти сохранения NES"; release(); return false; }
    if (LittleFS.exists(savePath_)) {
      File save = LittleFS.open(savePath_, "r");
      if (!save || save.size() != ramBytes || save.read(cart->prg_ram, ramBytes) != ramBytes) {
        error_ = "Ошибка чтения сохранения NES"; release(); return false;
      }
    }
    memcpy(savedRam, cart->prg_ram, ramBytes);
  }
  bool allocated = true;
  for (auto& buffer : buffers) {
    buffer = psram(nesvideo::frameBytes);
    allocated = allocated && buffer;
    if (buffer) memset(buffer, 0, nesvideo::frameBytes);
  }
  presented = psram(nesvideo::frameBytes);
  stripeBuffer = static_cast<uint16_t*>(heap_caps_malloc(nesvideo::width * nesvideo::stripeRows * 2,
                                                        MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT));
  if (!allocated || !presented || !stripeBuffer || !beginRenderer(display_)) {
    error_ = "Не хватает памяти для экрана NES"; release(); return false;
  }
  for (int i = 0; i < 64; ++i) {
    const auto* rgb = nes_palettes[0] + i * 3;
    colors[i] = (uint16_t(rgb[0] >> 3) << 11) | (uint16_t(rgb[1] >> 2) << 5) | (rgb[2] >> 3);
  }
  portENTER_CRITICAL(&mailboxMux);
  mailbox.reset(buffers[0], buffers[1], buffers[2]); replaced = 0;
  portEXIT_CRITICAL(&mailboxMux);
  displayed = 0;
  nes_setvidbuf(mailbox.writing());
  frameUs_ = header.pal ? 20000 : 16667;
  name_ = name; frames_ = 0; startFrames_ = selectFrames_ = 0;
  active_ = true; savedAt_ = millis();
  resume();
  Serial.printf("NES: started %s mapper=%u region=%s rom=%u ram=%u\n", name.c_str(), header.mapper,
                header.pal ? "PAL" : "NTSC", unsigned(size), unsigned(ramBytes));
  return true;
}

bool NesApp::save() {
  if (!active_ || !ramBytes || !memcmp(savedRam, core->cart->prg_ram, ramBytes)) return true;
  const String temporary = savePath_ + ".tmp";
  File file = LittleFS.open(temporary, "w");
  const bool written = file && file.write(core->cart->prg_ram, ramBytes) == ramBytes;
  file.close();
  if (!written || !LittleFS.rename(temporary, savePath_)) {
    LittleFS.remove(temporary); error_ = "Не удалось сохранить NES"; return false;
  }
  memcpy(savedRam, core->cart->prg_ram, ramBytes);
  savedAt_ = millis(); error_ = "";
  return true;
}

bool NesApp::stop() {
  if (!save()) return false;
  pause(); active_ = false; release(); return true;
}

void NesApp::pause() {
  if (!renderMutex) return;
  xSemaphoreTake(renderMutex, portMAX_DELAY);
  drawing = false;
  xSemaphoreTake(frameAvailable, 0);
  portENTER_CRITICAL(&mailboxMux);
  mailbox.discard();
  portEXIT_CRITICAL(&mailboxMux);
  xSemaphoreGive(renderMutex);
}

void NesApp::resume() {
  if (!active_) return;
  pause();
  xSemaphoreTake(renderMutex, portMAX_DELAY);
  display_.fillScreen(TFT_BLACK); presentedValid = false; drawing = true;
  xSemaphoreGive(renderMutex);
  nextFrame_ = micros();
}

void NesApp::update(const Controls& controls) {
  if (!active_) return;
  uint8_t keys = 0;
  if (controls.aDown) keys |= NES_PAD_A;
  if (controls.bDown) keys |= NES_PAD_B;
  if (controls.x > 0.45f) keys |= NES_PAD_RIGHT;
  if (controls.x < -0.45f) keys |= NES_PAD_LEFT;
  if (controls.y > 0.45f) keys |= NES_PAD_DOWN;
  if (controls.y < -0.45f) keys |= NES_PAD_UP;
  for (int step = 0; step < 3 && int32_t(micros() - nextFrame_) >= 0; ++step) {
    uint8_t state = keys;
    if (startFrames_) { state |= NES_PAD_START; --startFrames_; }
    if (selectFrames_) { state |= NES_PAD_SELECT; --selectFrames_; }
    input_update(0, state);
    nes_emulate(true); ++frames_;
    if (core->cpu->jammed) { error_ = "Процессор NES остановлен игрой"; return; }
    const uint8_t* complete = mailbox.writing();
    portENTER_CRITICAL(&mailboxMux);
    if (mailbox.publish()) ++replaced;
    portEXIT_CRITICAL(&mailboxMux);
    // Preserve untouched scanlines when rendering starts partway through a frame.
    memcpy(mailbox.writing(), complete, nesvideo::frameBytes);
    nes_setvidbuf(mailbox.writing());
    xSemaphoreGive(frameAvailable);
    nextFrame_ += frameUs_;
  }
  if (int32_t(micros() - nextFrame_) > 100000) nextFrame_ = micros();
  const uint32_t now = millis();
  if (uint32_t(now - savedAt_) >= 30000) { save(); savedAt_ = now; }
}

void NesApp::screenshot() {
  if (!active_) return;
  xSemaphoreTake(renderMutex, portMAX_DELAY);
  Serial.print("P6\n320 240\n255\n");
  uint8_t row[960];
  for (int y = 0; y < 240; ++y) {
    for (int x = 0; x < 320; ++x) {
      const uint16_t c = presentedValid ? nesvideo::pixel(presented, x, y, colors) : TFT_BLACK;
      row[x*3] = ((c >> 11) & 31) * 255 / 31;
      row[x*3+1] = ((c >> 5) & 63) * 255 / 63;
      row[x*3+2] = (c & 31) * 255 / 31;
    }
    Serial.write(row, sizeof(row));
  }
  xSemaphoreGive(renderMutex);
}

void NesApp::printVideoStatus() const {
  if (!active_) return;
  xSemaphoreTake(renderMutex, portMAX_DELAY);
  const uint32_t lcd = displayed;
  xSemaphoreGive(renderMutex);
  portENTER_CRITICAL(&mailboxMux);
  const uint32_t dropped = replaced;
  portEXIT_CRITICAL(&mailboxMux);
  Serial.printf("NES_VIDEO: rom=%s source=256x240 output=320x240 frames=%u displayed=%u replaced=%u region=%s spi_hz=%u\n",
                name_.c_str(), frames_, lcd, dropped, frameUs_ == 20000 ? "PAL" : "NTSC", unsigned(SPI_FREQUENCY));
}
