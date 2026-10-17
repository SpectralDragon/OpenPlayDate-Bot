#ifdef ROBOT_DISPLAY_SOFT_TEST

#include <Arduino.h>
#include <Adafruit_ILI9341.h>
#include "tft_setup.h"

// Independent software SPI: the same physical pins, no TFT_eSPI or sprites.
Adafruit_ILI9341 panel(TFT_CS, TFT_DC, TFT_MOSI, TFT_SCLK, TFT_RST, TFT_MISO);

void drawPattern() {
  panel.fillScreen(ILI9341_WHITE);
  panel.fillRect(0, 0, 106, 170, ILI9341_RED);
  panel.fillRect(106, 0, 107, 170, ILI9341_GREEN);
  panel.fillRect(213, 0, 107, 170, ILI9341_BLUE);
  panel.drawRect(0, 0, 320, 240, ILI9341_BLACK);
  panel.setTextColor(ILI9341_BLACK);
  panel.setTextSize(2);
  panel.setCursor(12, 185);
  panel.println("SOFTWARE SPI TEST");
  panel.setTextSize(1);
  panel.setCursor(12, 215);
  panel.println("ILI9341 / 320x240 / Adafruit");
  Serial.println("SOFT TEST: pattern sent; visual confirmation required");
}

void setup() {
  Serial.begin(115200);
  panel.begin();
  panel.setRotation(1);
  drawPattern();
}

void loop() {
  if (Serial.available() && Serial.read() == 't') drawPattern();
  delay(1);
}

#endif
