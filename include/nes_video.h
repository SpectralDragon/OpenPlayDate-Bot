#pragma once
#include "gb_video.h"

namespace nesvideo {
// Nofrendo needs eight padding pixels on each side for sprite rendering.
constexpr int sourceWidth = 256, height = 240, pitch = 272, padding = 8;
constexpr int width = 320, stripeRows = 8;
constexpr size_t frameBytes = pitch * height;
using Mailbox = gbvideo::Mailbox;  // The buffer exchange has no dimensions.
using Rect = gbvideo::Rect;
struct Damage { Rect rects[height / stripeRows]; size_t count = 0; };

inline Damage findDamage(const uint8_t* frame, const uint8_t* previous, bool valid) {
  Damage damage{};
  for (int y = 0; y < height; y += stripeRows) {
    int left = sourceWidth, right = 0;
    for (int row = 0; row < stripeRows; ++row) {
      const int offset = (y + row) * pitch + padding;
      for (int x = 0; x < sourceWidth; ++x) {
        if (!valid || ((frame[offset+x] ^ previous[offset+x]) & 63)) {
          if (x < left) left = x;
          if (x + 1 > right) right = x + 1;
        }
      }
    }
    if (left >= right) continue;
    const int x = (left * width + sourceWidth - 1) / sourceWidth;
    const int end = (right * width + sourceWidth - 1) / sourceWidth;
    damage.rects[damage.count++] = {uint16_t(x), uint16_t(y), uint16_t(end-x), stripeRows};
  }
  return damage;
}

inline uint16_t pixel(const uint8_t* frame, int x, int y, const uint16_t* palette) {
  return palette[frame[y * pitch + padding + x * sourceWidth / width] & 63];
}

inline void stripe(const uint8_t* frame, const Rect& rect, const uint16_t* palette, uint16_t* out) {
  for (int row = 0; row < rect.h; ++row)
    for (int x = rect.x; x < rect.x + rect.w; ++x)
      *out++ = pixel(frame, x, rect.y + row, palette);
}
}
