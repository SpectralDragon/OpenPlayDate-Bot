#include "controls.h"
#include <math.h>

void Button::begin() {
  pinMode(pin_, INPUT_PULLUP);
  raw_ = down_ = digitalRead(pin_) == LOW;
  changedAt_ = millis();
}

bool Button::pressed(uint32_t now) {
  const bool value = digitalRead(pin_) == LOW;
  if (value != raw_) {
    raw_ = value;
    changedAt_ = now;
  }
  if (raw_ != down_ && uint32_t(now - changedAt_) >= config::debounceMs) {
    down_ = raw_;
    return down_;
  }
  return false;
}

void Controls::begin() {
  stick_.begin();
  a_.begin();
  b_.begin();
  analogReadResolution(12);
  analogSetPinAttenuation(config::joystickX, ADC_11db);
  analogSetPinAttenuation(config::joystickY, ADC_11db);
  // Keep the stick released at power-on while its centre is sampled.
  int sumX = 0;
  int sumY = 0;
  for (int i = 0; i < 32; ++i) {
    sumX += analogRead(config::joystickX);
    sumY += analogRead(config::joystickY);
    delay(2);
  }
  centerX_ = constrain(sumX / 32, 512, 3583);
  centerY_ = constrain(sumY / 32, 512, 3583);
  lastActivity = millis();
  Serial.printf("Joystick centre: %d, %d\n", centerX_, centerY_);
}

float Controls::axis(int value, int center) {
  const int delta = value - center;
  if (abs(delta) <= config::deadZone) return 0;
  const int span = delta > 0 ? config::adcMax - center : center;
  const float magnitude = float(abs(delta) - config::deadZone) /
                          float(span - config::deadZone);
  return constrain(delta > 0 ? magnitude : -magnitude, -1.0f, 1.0f);
}

void Controls::update(uint32_t now) {
  x = axis(analogRead(config::joystickX), centerX_);
  y = axis(analogRead(config::joystickY), centerY_);
  if (config::invertX) x = -x;
  if (config::invertY) y = -y;
  blink = stick_.pressed(now);
  nextMood = a_.pressed(now);
  nextColor = b_.pressed(now);
  aDown = a_.down();
  bDown = b_.down();
  stickDown = stick_.down();
  if (blink) Serial.println("PRESS: STICK");
  if (nextMood) Serial.println("PRESS: A");
  if (nextColor) Serial.println("PRESS: B");
  if (fabsf(x) > 0.01f || fabsf(y) > 0.01f || blink || nextMood || nextColor) {
    lastActivity = now;
  }
}
