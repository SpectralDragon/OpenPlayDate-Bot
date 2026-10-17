#pragma once

#include <TFT_eSPI.h>
#include "controls.h"

class Eyes {
 public:
  explicit Eyes(TFT_eSPI& display) : display_(display), frame_(&display) {}
  bool begin();
  void update(uint32_t now, const Controls& controls);
  void setTheme(uint8_t theme) { color_ = theme == 1 ? 1 : theme == 2 ? 2 : 0; }

 private:
  TFT_eSPI& display_;
  TFT_eSprite frame_;
  uint8_t mood_ = 0;
  uint8_t color_ = 0;
  float gazeX_ = 0;
  float gazeY_ = 0;
  float idleX_ = 0;
  float idleY_ = 0;
  bool blinking_ = false;
  uint32_t blinkAt_ = 0;
  uint32_t lastBlink_ = 0;
  uint32_t blinkInterval_ = 2200;
  uint32_t lastGlance_ = 0;
  uint32_t glanceInterval_ = 1500;
  uint32_t lastFrame_ = 0;
  void drawEye(int cx, int cy, int height, float openness, bool right);
};
