#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <utility>

// Hardware-independent parts of the Game Boy video pipeline, also used by
// native tests. The caller serializes mailbox swaps across the two cores.
namespace gbvideo {
constexpr int sourceWidth = 160, sourceHeight = 144;
constexpr int width = 266, height = 240, offsetX = (320 - width) / 2;
constexpr size_t frameBytes = sourceWidth * sourceHeight;
constexpr int stripeRows = 8;
constexpr uint16_t palette[] = {0xE7DA, 0xA630, 0x54A8, 0x19C4};

class Mailbox {
 public:
  void reset(uint8_t* writing = nullptr, uint8_t* pending = nullptr, uint8_t* reading = nullptr) {
    writing_ = writing; pending_ = pending; reading_ = reading; ready_ = false;
  }
  uint8_t* writing() const { return writing_; }
  // Latest frame wins. Never touch the buffer currently owned by the display.
  bool publish() {
    const bool replaced = ready_;
    std::swap(writing_, pending_); ready_ = true;
    return replaced;
  }
  const uint8_t* consume() {
    if (!ready_) return nullptr;
    std::swap(reading_, pending_); ready_ = false;
    return reading_;
  }
  void discard() { ready_ = false; }
 private:
  uint8_t *writing_ = nullptr, *pending_ = nullptr, *reading_ = nullptr;
  bool ready_ = false;
};

struct Rect { uint16_t x, y, w, h; };
struct Damage {
  static constexpr size_t maxRects = 32;
  Rect rects[maxRects];
  size_t count = 0;
};

inline Damage fullDamage() {
  Damage damage{};
  damage.rects[0] = {0, 0, sourceWidth, sourceHeight}; damage.count = 1;
  return damage;
}

inline bool tileChanged(const uint8_t* frame, const uint8_t* previous, int x, int y) {
  for (int row = 0; row < 8; ++row)
    if (memcmp(frame + (y + row) * sourceWidth + x,
               previous + (y + row) * sourceWidth + x, 8)) return true;
  return false;
}

inline Damage findDamage(const uint8_t* frame, const uint8_t* previous, bool previousValid) {
  if (!previousValid) return fullDamage();
  Damage damage{};
  for (int y = 0; y < sourceHeight; y += 8) {
    for (int x = 0; x < sourceWidth;) {
      if (!tileChanged(frame, previous, x, y)) { x += 8; continue; }
      const int start = x;
      do { x += 8; } while (x < sourceWidth && tileChanged(frame, previous, x, y));
      bool merged = false;
      for (size_t i = 0; i < damage.count; ++i) {
        auto& rect = damage.rects[i];
        if (rect.x == start && rect.w == x - start && rect.y + rect.h == y) {
          rect.h += 8; merged = true; break;
        }
      }
      if (!merged) {
        // Highly fragmented changes cost more windows than a full transfer.
        if (damage.count == Damage::maxRects) return fullDamage();
        damage.rects[damage.count++] = {uint16_t(start), uint16_t(y), uint16_t(x - start), 8};
      }
    }
  }
  return damage;
}

// ceil() at boundaries is essential: output uses floor(x * 160 / 266).
// A source tile's corresponding LCD rectangle must include every such pixel.
inline Rect destination(const Rect& rect) {
  const int x = (rect.x * width + sourceWidth - 1) / sourceWidth;
  const int y = (rect.y * height + sourceHeight - 1) / sourceHeight;
  const int right = ((rect.x + rect.w) * width + sourceWidth - 1) / sourceWidth;
  const int bottom = ((rect.y + rect.h) * height + sourceHeight - 1) / sourceHeight;
  return {uint16_t(x), uint16_t(y), uint16_t(right - x), uint16_t(bottom - y)};
}

class Scaler {
 public:
  Scaler() {
    for (int x = 0; x < width; ++x) x_[x] = x * sourceWidth / width;
    for (int y = 0; y < height; ++y) y_[y] = y * sourceHeight / height;
  }
  uint16_t pixel(const uint8_t* frame, int x, int y) const {
    return palette[frame[y_[y] * sourceWidth + x_[x]] & 3];
  }
  void stripe(const uint8_t* frame, int x, int y, int w, int rows, uint16_t* output,
              bool wireOrder = true) const {
    // Wire byte order once, while scaling, instead of a second byte-swap pass.
    constexpr uint16_t wire[] = {0xDAE7, 0x30A6, 0xA854, 0xC419};
    const uint16_t* colors = wireOrder ? wire : palette;
    for (int row = 0; row < rows; ++row) {
      const uint8_t* source = frame + y_[y + row] * sourceWidth;
      for (int col = 0; col < w; ++col) *output++ = colors[source[x_[x + col]] & 3];
    }
  }
 private:
  uint8_t x_[width], y_[height];
};
}
