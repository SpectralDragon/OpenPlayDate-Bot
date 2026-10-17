#pragma once

#include <stdint.h>

namespace config {
constexpr uint8_t joystickX = 4;
constexpr uint8_t joystickY = 5;
constexpr uint8_t joystickButton = 6;
constexpr uint8_t buttonA = 7;
constexpr uint8_t buttonB = 15;
constexpr uint8_t rotation = 1;  // Landscape 320 x 240; use 3 to turn upside down.
constexpr bool invertX = false;
constexpr bool invertY = false;
constexpr int adcMax = 4095;
constexpr int deadZone = 180;
constexpr uint32_t frameMs = 33;
constexpr uint32_t debounceMs = 25;
constexpr uint32_t idleAfterMs = 5000;
}
