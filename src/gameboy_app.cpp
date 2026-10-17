#include "gameboy_app.h"
#include "rom_store.h"
#include <LittleFS.h>
#include <esp_heap_caps.h>
#include <setjmp.h>
#define ENABLE_SOUND 0
#define PEANUT_GB_12_COLOUR 0
#include <peanut_gb.h>

namespace {
gb_s core;
uint8_t* rom = nullptr;
uint8_t* ram = nullptr;
uint16_t* pixels = nullptr;
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
  constexpr uint16_t palette[] = {0xE7DA, 0xA630, 0x54A8, 0x19C4};
  if (y >= 144) return;
  for (int x = 0; x < 160; ++x) pixels[y * 160 + x] = palette[line[x] & 3];
}
void release() {
  free(rom); free(ram); free(pixels);
  rom = nullptr; ram = nullptr; pixels = nullptr;
  romSize = ramSize = 0;
}
}

bool GameBoyApp::start(const String& name) {
  if (active_) return false;
  error_ = "";
  File file = LittleFS.open("/roms/" + name, "r");
  error_ = roms::validate(file);
  if (!error_.isEmpty()) return false;
  romSize = file.size();
  rom = static_cast<uint8_t*>(heap_caps_malloc(romSize, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
  pixels = static_cast<uint16_t*>(heap_caps_malloc(160 * 144 * 2, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
  if (!rom || !pixels) { error_ = "Не хватает памяти PSRAM"; release(); return false; }
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
  memset(pixels, 0, 160 * 144 * 2);
  gb_init_lcd(&core, drawLine);
  time_t timestamp = time(nullptr);
  if (timestamp > 1600000000) { tm clock; localtime_r(&timestamp, &clock); gb_set_rtc(&core, &clock); }
  dirty = false; active_ = true; frames_ = 0;
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
  active_ = false; release();
  return true;
}

void GameBoyApp::resume() {
  display_.fillScreen(TFT_BLACK);
  display_.setTextColor(0xA630, TFT_BLACK);
  display_.drawCentreString("GAME BOY", 160, 12, 2);
  display_.drawCentreString("Hold stick: menu", 160, 211, 2);
  nextFrame_ = micros();
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
  bool render = false;
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
    gb_run_frame(&core);
    nextFrame_ += 16743;
    ++frames_;
    if ((frames_ % 3) == 0) render = true;
  }
  // Bound catch-up after a slow flash operation to keep controls responsive.
  if (int32_t(micros() - nextFrame_) > 100000) nextFrame_ = micros();
  if (render) {
    const bool swap = display_.getSwapBytes();
    display_.setSwapBytes(true);
    display_.pushImage(80, 48, 160, 144, pixels);
    display_.setSwapBytes(swap);
  }
  const uint32_t now = millis();
  if (uint32_t(now - savedAt_) >= 30000) { save(); savedAt_ = now; }
}

void GameBoyApp::screenshot() {
  Serial.print("P6\n160 144\n255\n");
  uint8_t row[480];
  for (int y = 0; y < 144; ++y) {
    for (int x = 0; x < 160; ++x) {
      uint16_t c = pixels[y * 160 + x];
      row[x * 3] = ((c >> 11) & 31) * 255 / 31;
      row[x * 3 + 1] = ((c >> 5) & 63) * 255 / 63;
      row[x * 3 + 2] = (c & 31) * 255 / 31;
    }
    Serial.write(row, sizeof(row));
  }
}
