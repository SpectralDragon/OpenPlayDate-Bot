#include "device_settings.h"
#include <TFT_eSPI.h>

void DeviceSettings::begin() {
  storage_.begin("openplay", false);
  theme = storage_.getUChar("theme", 0) % 3;
  idle = storage_.getUChar("idle", 1) % 4;
  wifiEnabled = storage_.getBool("wifi", true);
  ssid = storage_.getString("ssid", "");
  password = storage_.getString("password", "");
}

void DeviceSettings::save() {
  storage_.putUChar("theme", theme);
  storage_.putUChar("idle", idle);
  storage_.putBool("wifi", wifiEnabled);
  storage_.putString("ssid", ssid);
  storage_.putString("password", password);
}

Palette DeviceSettings::palette() const {
  constexpr Palette palettes[] = {
    {0x1082, 0x2124, 0xFFDE, 0x9CF3, 0xFF05, 0x1082},
    {0x0841, 0x1945, 0xEFFF, 0x94F3, 0x77D3, 0x0841},
    {0x1083, 0x2927, 0xF7BF, 0xAD15, 0xC47F, 0x1083}
  };
  return palettes[theme % 3];
}

const char* DeviceSettings::themeName() const {
  const char* names[] = {"Солнечная", "Мятная", "Сиреневая"};
  return names[theme % 3];
}

uint32_t DeviceSettings::idleMs() const {
  constexpr uint32_t values[] = {30000, 60000, 120000, 0};
  return values[idle % 4];
}
