#pragma once

#include <Arduino.h>
#include "robot_config.h"

class Button {
 public:
  explicit Button(uint8_t pin) : pin_(pin) {}
  void begin();
  bool pressed(uint32_t now);
  bool down() const { return down_; }

 private:
  uint8_t pin_;
  bool raw_ = false;
  bool down_ = false;
  uint32_t changedAt_ = 0;
};

class Controls {
 public:
  void begin();
  void update(uint32_t now);
  float x = 0;
  float y = 0;
  bool blink = false;
  bool nextMood = false;
  bool nextColor = false;
  bool aDown = false;
  bool bDown = false;
  bool stickDown = false;
  uint32_t lastActivity = 0;

 private:
  Button stick_{config::joystickButton};
  Button a_{config::buttonA};
  Button b_{config::buttonB};
  int centerX_ = 2048;
  int centerY_ = 2048;
  static float axis(int value, int center);
};
