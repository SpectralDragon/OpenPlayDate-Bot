#include <Arduino.h>
#include <TFT_eSPI.h>
#include <esp_system.h>
#include "controls.h"
#include "eyes.h"
#include "display_test.h"
#include "console_shell.h"

TFT_eSPI display;
Controls controls;
Eyes eyes(display);
ConsoleShell shell(display, eyes);
bool ready = false;
bool watchButtons = false;
int lastButtons = -1;
#ifdef ROBOT_DISPLAY_TEST_AT_BOOT
bool displayTest = true;
#else
bool displayTest = false;
#endif

void printButtons(bool force = false) {
  const int a = digitalRead(config::buttonA);
  const int b = digitalRead(config::buttonB);
  const int stick = digitalRead(config::joystickButton);
  const int state = a | (b << 1) | (stick << 2);
  if (!force && state == lastButtons) return;
  lastButtons = state;
  Serial.printf("BUTTONS: A(GPIO%u)=%d B(GPIO%u)=%d STICK(GPIO%u)=%d | 0=pressed 1=released\n",
                config::buttonA, a, config::buttonB, b,
                config::joystickButton, stick);
}

void printStatus() {
  setup_t screen;
  display.getSetup(screen);
  Serial.printf("STATUS: ready=%d test=%d configured_driver=%04X size=%dx%d\n",
                ready, displayTest, screen.tft_driver,
                display.width(), display.height());
  printButtons(true);
  shell.printStatus();
  Serial.printf("SYSTEM: reset_reason=%d heap=%u largest_internal=%u\n", esp_reset_reason(),
                ESP.getFreeHeap(), heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL));
}

void setup() {
  Serial.begin(115200);
  // The face must start even when no serial monitor is connected.
  randomSeed(esp_random());
  controls.begin();
  display.init();
  display.setRotation(config::rotation);
  setup_t screen;
  display.getSetup(screen);
  Serial.printf("TFT: driver=%04X MOSI=%d SCK=%d CS=%d DC=%d RST=%d\n",
                screen.tft_driver, screen.pin_tft_mosi, screen.pin_tft_clk,
                screen.pin_tft_cs, screen.pin_tft_dc, screen.pin_tft_rst);
  ready = eyes.begin();
  if (ready) ready = shell.begin();
  if (!ready) {
    display.fillScreen(TFT_BLACK);
    display.setTextColor(TFT_RED, TFT_BLACK);
    display.drawString("Not enough RAM for eyes", 12, 100, 2);
    Serial.println("ERROR: frame allocation failed");
  }
  Serial.printf("Robot eyes ready=%d | flash=%u | PSRAM=%u\n",
                ready, ESP.getFlashChipSize(), ESP.getPsramSize());
  Serial.println("OpenPlay OS 0.1 | Standby: eyes, any button: home | A: select, B: back");
  Serial.println("Serial: t = colour bars, e = eyes, s = status, c = watch buttons on/off");
  Serial.println("Shell service: m = home, j/k = next/previous, a/b = select/back, z = standby, v = PPM screenshot");
  if (displayTest) {
    drawDisplayTest(display);
    Serial.println("DISPLAY TEST: colour bars sent; visual confirmation required");
  }
}

void loop() {
  while (Serial.available()) {
    const char command = Serial.read();
    if (command == 't') {
      shell.command('m');
      displayTest = true;
      drawDisplayTest(display);
      Serial.println("DISPLAY TEST: colour bars sent; visual confirmation required");
    } else if (command == 'e') {
      displayTest = false;
      display.fillScreen(TFT_BLACK);
      shell.command('z');
      shell.invalidate();
      Serial.println("DISPLAY TEST: returning to eyes");
    } else if (command == 's') {
      printStatus();
    } else if (command == 'c') {
      watchButtons = !watchButtons;
      Serial.printf("BUTTON WATCH: %s\n", watchButtons ? "on" : "off");
      printButtons(true);
    } else if (ready && !displayTest) {
      shell.command(command);
    }
  }
  if (watchButtons) printButtons();
  if (ready && !displayTest) {
    const uint32_t now = millis();
    controls.update(now);
    shell.update(now, controls);
  }
  delay(1);
}
