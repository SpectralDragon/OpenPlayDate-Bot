#ifdef ROBOT_DISPLAY_ID_ONLY

#include <Arduino.h>
#include "tft_setup.h"

namespace {
// Slow software SPI reads the controller without relying on a TFT driver,
// a framebuffer, or the ESP32-S3 hardware SPI register mapping.
uint8_t transferByte(uint8_t value) {
  uint8_t result = 0;
  for (int bit = 7; bit >= 0; --bit) {
    digitalWrite(TFT_MOSI, (value >> bit) & 1);
    delayMicroseconds(5);
    digitalWrite(TFT_SCLK, HIGH);
    delayMicroseconds(5);
    result = (result << 1) | digitalRead(TFT_MISO);
    digitalWrite(TFT_SCLK, LOW);
  }
  return result;
}

void readRegister(uint8_t command) {
  digitalWrite(TFT_CS, LOW);
  digitalWrite(TFT_DC, LOW);
  transferByte(command);
  digitalWrite(TFT_DC, HIGH);
  Serial.printf("REG %02X:", command);
  // Include the dummy byte in the output so the response is unambiguous.
  for (int i = 0; i < 6; ++i) Serial.printf(" %02X", transferByte(0));
  digitalWrite(TFT_CS, HIGH);
  Serial.println();
}

void readSharedRegister(uint8_t command, uint8_t mode) {
  pinMode(TFT_MOSI, OUTPUT);
  digitalWrite(TFT_CS, LOW);
  digitalWrite(TFT_DC, LOW);
  transferByte(command);
  pinMode(TFT_MOSI, mode);
  digitalWrite(TFT_DC, HIGH);
  // Shared-SDA panels use one dummy clock before their register response.
  // This follows TFT_eSPI's Read_ID_bitbash example (no display library used).
  digitalWrite(TFT_SCLK, HIGH);
  delayMicroseconds(5);
  digitalWrite(TFT_SCLK, LOW);
  delayMicroseconds(5);
  Serial.printf("SDA REG %02X:", command);
  for (int byte = 0; byte < 6; ++byte) {
    uint8_t value = 0;
    for (int bit = 0; bit < 8; ++bit) {
      value = (value << 1) | digitalRead(TFT_MOSI);
      digitalWrite(TFT_SCLK, HIGH);
      delayMicroseconds(5);
      digitalWrite(TFT_SCLK, LOW);
      delayMicroseconds(5);
    }
    Serial.printf(" %02X", value);
  }
  digitalWrite(TFT_CS, HIGH);
  pinMode(TFT_MOSI, OUTPUT);
  Serial.println();
}

void probe() {
  Serial.println("DISPLAY PROBE: software SPI, SDO(MISO) -> GPIO13");
  for (int pull = 0; pull < 2; ++pull) {
    pinMode(TFT_MISO, pull == 0 ? INPUT_PULLDOWN : INPUT_PULLUP);
    Serial.println(pull == 0 ? "MISO pull-down:" : "MISO pull-up:");
    for (uint8_t command : {0x04, 0xD3, 0x09, 0x0A, 0x0B, 0x0C, 0xDA, 0xDB, 0xDC}) {
      readRegister(command);
    }
  }
  for (int pull = 0; pull < 2; ++pull) {
    const uint8_t mode = pull == 0 ? INPUT_PULLDOWN : INPUT_PULLUP;
    Serial.println(pull == 0 ? "Shared SDA pull-down:" : "Shared SDA pull-up:");
    for (uint8_t command : {0x04, 0xD3, 0x09, 0x0A, 0x0B, 0x0C, 0xDA, 0xDB, 0xDC}) {
      readSharedRegister(command, mode);
    }
  }
  Serial.println("DISPLAY PROBE END; repeat with i");
}
}

void setup() {
  Serial.begin(115200);
  digitalWrite(TFT_CS, HIGH);
  digitalWrite(TFT_SCLK, LOW);
  digitalWrite(TFT_DC, HIGH);
  digitalWrite(TFT_RST, HIGH);
  pinMode(TFT_CS, OUTPUT);
  pinMode(TFT_SCLK, OUTPUT);
  pinMode(TFT_MOSI, OUTPUT);
  pinMode(TFT_DC, OUTPUT);
  pinMode(TFT_RST, OUTPUT);
  digitalWrite(TFT_RST, LOW);
  delay(40);
  digitalWrite(TFT_RST, HIGH);
  delay(150);
}

void loop() {
  if (Serial.available() && Serial.read() == 'i') probe();
  delay(1);
}

#endif
