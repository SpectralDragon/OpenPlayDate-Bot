#include "display_test.h"

void drawDisplayTest(TFT_eSPI& display) {
  const int w = display.width();
  const int h = display.height();
  display.fillScreen(TFT_WHITE);
  display.fillRect(0, 0, w / 3, h - 60, TFT_RED);
  display.fillRect(w / 3, 0, w / 3, h - 60, TFT_GREEN);
  display.fillRect(2 * w / 3, 0, w - 2 * w / 3, h - 60, TFT_BLUE);
  display.drawRect(0, 0, w, h, TFT_BLACK);
  display.setTextColor(TFT_BLACK, TFT_WHITE);
  display.drawString("ROBOT DISPLAY TEST", 12, h - 54, 2);
  display.drawString("MOSI 11 / SCK 12 / CS 10", 12, h - 32, 2);
  display.drawString("DC 9 / RESET 14", 12, h - 17, 1);
  // All four markers must be visible in their respective corners. A clean
  // fill alone cannot distinguish a correct panel size from an oversized one.
  display.setTextColor(TFT_WHITE, TFT_BLACK);
  display.drawString("1", 3, 3, 1);
  display.drawString("2", w - 10, 3, 1);
  display.drawString("3", 3, h - 11, 1);
  display.drawString("4", w - 10, h - 11, 1);
  display.setTextColor(TFT_WHITE, TFT_RED);
  display.drawString("RED", 8, 28, 2);
  display.setTextColor(TFT_BLACK, TFT_GREEN);
  display.drawString("GREEN", w / 3 + 8, 28, 2);
  display.setTextColor(TFT_WHITE, TFT_BLUE);
  display.drawString("BLUE", 2 * w / 3 + 8, 28, 2);
  setup_t screen;
  display.getSetup(screen);
  char dimensions[40];
  snprintf(dimensions, sizeof(dimensions), "%04X %dx%d", screen.tft_driver, w, h);
  display.setTextColor(TFT_WHITE, TFT_BLACK);
  display.drawString(dimensions, w / 2 - 42, 3, 1);
}
