#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>

// Compare final pixels, so games may still clear and redraw the whole canvas.
namespace luavideo {
constexpr int width = 320, height = 240;
constexpr size_t frameBytes = width * height * sizeof(uint16_t);
struct Rect { uint16_t x, y, w, h; };
struct Damage {
  static constexpr size_t maxRects = 64;
  Rect rects[maxRects];
  size_t count = 0;
};
inline Damage fullDamage() {
  Damage damage{};
  damage.rects[0] = {0, 0, width, height}; damage.count = 1;
  return damage;
}
inline bool tileChanged(const uint16_t* frame, const uint16_t* previous, int x, int y) {
  for (int row = 0; row < 8; ++row)
    if (memcmp(frame + (y + row) * width + x,
               previous + (y + row) * width + x, 16 * sizeof(uint16_t))) return true;
  return false;
}
inline Damage findDamage(const uint16_t* frame, const uint16_t* previous, bool valid) {
  if (!valid) return fullDamage();
  Damage damage{};
  for (int y = 0; y < height; y += 8) {
    for (int x = 0; x < width;) {
      if (!tileChanged(frame, previous, x, y)) { x += 16; continue; }
      const int start = x;
      do { x += 16; } while (x < width && tileChanged(frame, previous, x, y));
      bool merged = false;
      for (size_t i = 0; i < damage.count; ++i) {
        auto& rect = damage.rects[i];
        if (rect.x == start && rect.w == x - start && rect.y + rect.h == y) {
          rect.h += 8; merged = true; break;
        }
      }
      if (!merged) {
        if (damage.count == Damage::maxRects) return fullDamage();
        damage.rects[damage.count++] = {uint16_t(start), uint16_t(y), uint16_t(x - start), 8};
      }
    }
  }
  return damage;
}
}
