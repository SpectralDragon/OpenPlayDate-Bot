#include "eyes.h"
#include <math.h>

namespace {
constexpr int faceWidth = 320;
constexpr int faceHeight = 160;
constexpr uint16_t colors[] = {TFT_CYAN, TFT_GREEN, TFT_MAGENTA, TFT_YELLOW};
constexpr const char* moods[] = {"curious", "happy", "sleepy", "surprised"};
}

bool Eyes::begin() {
  frame_.setColorDepth(16);
  // Fits in internal RAM even if PSRAM is absent; keeps drawing responsive.
  frame_.setAttribute(PSRAM_ENABLE, false);
  if (frame_.createSprite(faceWidth, faceHeight) == nullptr) return false;
  display_.fillScreen(TFT_BLACK);
  return true;
}

void Eyes::drawEye(int cx, int cy, int height, float openness, bool right) {
  const int width = mood_ == 3 ? 70 : 78;
  const int h = max(4, int(height * openness));
  const int left = cx - width / 2;
  const int top = cy - h / 2;
  const int radius = min(20, h / 2);
  const uint16_t ink = colors[color_];
  frame_.fillRoundRect(left, top, width, h, radius, ink);

  if (openness > 0.8f && mood_ == 1) {
    // A rounded black mask turns the eyes into two smiling arches.
    frame_.fillRoundRect(left - 2, top + h / 3, width + 4, h, 28, TFT_BLACK);
  } else if (openness > 0.8f && mood_ != 2 && h > 30) {
    frame_.fillRoundRect(left + 12, top + 10, 15, 7, 3, TFT_WHITE);
  }
  if (mood_ == 0 && right && openness > 0.8f) {
    frame_.drawWideLine(left + 6, top - 12, left + width - 6,
                        top - 18, 4, ink, TFT_BLACK);
  }
}

void Eyes::update(uint32_t now, const Controls& controls) {
  if (controls.nextMood) {
    mood_ = (mood_ + 1) % 4;
    Serial.printf("Mood: %s\n", moods[mood_]);
  }
  if (controls.nextColor) color_ = (color_ + 1) % 4;
  if (!blinking_ && (controls.blink || uint32_t(now - lastBlink_) >= blinkInterval_)) {
    blinking_ = true;
    blinkAt_ = now;
  }
  float openness = 1;
  if (blinking_) {
    const uint32_t elapsed = now - blinkAt_;
    if (elapsed < 80) openness = 1.0f - elapsed / 80.0f;
    else if (elapsed < 130) openness = 0;
    else if (elapsed < 250) openness = (elapsed - 130) / 120.0f;
    else {
      blinking_ = false;
      lastBlink_ = now;
      blinkInterval_ = random(2200, 5500);
    }
  }

  const bool idle = uint32_t(now - controls.lastActivity) >= config::idleAfterMs;
  if (idle && uint32_t(now - lastGlance_) >= glanceInterval_) {
    idleX_ = random(-75, 76) / 100.0f;
    idleY_ = random(-45, 46) / 100.0f;
    lastGlance_ = now;
    glanceInterval_ = random(900, 2300);
  }
  if (uint32_t(now - lastFrame_) < config::frameMs) return;
  lastFrame_ = now;
  gazeX_ += ((idle ? idleX_ : controls.x) - gazeX_) * 0.22f;
  gazeY_ += ((idle ? idleY_ : controls.y) - gazeY_) * 0.22f;

  frame_.fillSprite(TFT_BLACK);
  const int dx = lroundf(gazeX_ * 22);
  const int dy = lroundf(gazeY_ * 15);
  int height = 78;
  if (mood_ == 1) height = 68;
  if (mood_ == 2) height = 26;
  if (mood_ == 3) height = 102;
  drawEye(93 + dx, 80 + dy, height, openness, false);
  drawEye(227 + dx, 80 + dy, mood_ == 0 ? height + 12 : height, openness, true);
  frame_.pushSprite((display_.width() - faceWidth) / 2,
                    (display_.height() - faceHeight) / 2);
}
