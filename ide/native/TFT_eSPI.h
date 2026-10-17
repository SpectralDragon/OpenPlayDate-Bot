#pragma once
#include "Arduino.h"
constexpr int PSRAM_ENABLE = 1;
constexpr uint16_t TFT_BLACK = 0, TFT_WHITE = 65535;
class TFT_eSPI {};
// Desktop display adapter. LuaApp and uiText are the actual firmware sources.
class TFT_eSprite {
  std::vector<uint16_t> pixels_;
 public:
  uint32_t textcolor = TFT_WHITE;
  explicit TFT_eSprite(TFT_eSPI*) {}
  void setColorDepth(int) {}
  void setAttribute(int, bool) {}
  void* createSprite(int w, int h) { pixels_.assign(w * h, 0); return pixels_.data(); }
  void deleteSprite() { pixels_.clear(); }
  void fillSprite(uint16_t c) { std::fill(pixels_.begin(), pixels_.end(), c); }
  void setTextColor(uint16_t c, uint16_t = 0) { textcolor = c; }
  void pushSprite(int, int) {}
  const uint16_t* pixels() const { return pixels_.data(); }
  void drawPixel(int x, int y, uint16_t c) {
    if (x >= 0 && x < 320 && y >= 0 && y < 240 && !pixels_.empty()) pixels_[y * 320 + x] = c;
  }
  uint16_t readPixel(int x, int y) { return pixels_.at(y * 320 + x); }
  void drawLine(int x, int y, int x2, int y2, uint16_t c) {
    int dx = abs(x2-x), sx = x < x2 ? 1 : -1, dy = -abs(y2-y), sy = y < y2 ? 1 : -1;
    int error = dx + dy;
    for (;;) {
      drawPixel(x, y, c); if (x == x2 && y == y2) break;
      int e = 2 * error;
      if (e >= dy) { error += dy; x += sx; }
      if (e <= dx) { error += dx; y += sy; }
    }
  }
  void drawRect(int x, int y, int w, int h, uint16_t c) {
    if (!w || !h) return;
    drawLine(x,y,x+w-1,y,c); drawLine(x,y+h-1,x+w-1,y+h-1,c);
    drawLine(x,y,x,y+h-1,c); drawLine(x+w-1,y,x+w-1,y+h-1,c);
  }
  void fillRect(int x, int y, int w, int h, uint16_t c) {
    for (int iy = std::max(y,0); iy < std::min(y+h,240); ++iy)
      for (int ix = std::max(x,0); ix < std::min(x+w,320); ++ix) drawPixel(ix,iy,c);
  }
  // Midpoint circles follow TFT_eSPI's integer rasterization.
  void drawCircle(int x, int y, int r, uint16_t c) {
    int f=1-r, dx=1, dy=-2*r, a=0, b=r;
    drawPixel(x,y+r,c); drawPixel(x,y-r,c); drawPixel(x+r,y,c); drawPixel(x-r,y,c);
    while (a < b) {
      if (f >= 0) { --b; dy+=2; f+=dy; } ++a; dx+=2; f+=dx;
      for (int s : {-1,1}) for (int t : {-1,1}) {
        drawPixel(x+s*a,y+t*b,c); drawPixel(x+s*b,y+t*a,c);
      }
    }
  }
  void fillCircle(int x, int y, int r, uint16_t c) {
    int f=1-r, dx=1, dy=-2*r, a=0, b=r;
    drawLine(x,y-r,x,y+r,c);
    while (a < b) {
      if (f >= 0) { --b; dy+=2; f+=dy; } ++a; dx+=2; f+=dx;
      drawLine(x+a,y-b,x+a,y+b,c); drawLine(x-a,y-b,x-a,y+b,c);
      drawLine(x+b,y-a,x+b,y+a,c); drawLine(x-b,y-a,x-b,y+a,c);
    }
  }
};
