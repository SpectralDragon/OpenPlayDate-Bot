#pragma once
#include <Arduino.h>
#include <Preferences.h>

struct Palette {
  uint16_t background, panel, foreground, muted, accent, ink;
};

class DeviceSettings {
 public:
  void begin();
  void save();
  Palette palette() const;
  const char* themeName() const;
  uint32_t idleMs() const;
  uint8_t theme = 0;
  uint8_t idle = 1;
  bool wifiEnabled = true;
  String ssid;
  String password;
 private:
  Preferences storage_;
};
