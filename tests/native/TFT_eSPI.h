#pragma once
#include "Arduino.h"
constexpr int PSRAM_ENABLE = 1;
constexpr uint16_t TFT_BLACK = 0, TFT_WHITE = 65535;
class TFT_eSPI {
 public:
  std::vector<uint16_t> pixels = std::vector<uint16_t>(320 * 240);
  size_t bytes = 0, transfers = 0;
  void startWrite() {}
  void endWrite() {}
};
class TFT_eSprite {
  std::vector<uint16_t> pixels_;
  TFT_eSPI* display_;
  bool swap_ = false;
 public:
  uint32_t textcolor = TFT_WHITE;
  explicit TFT_eSprite(TFT_eSPI* display) : display_(display) {}
  void setColorDepth(int) {}
  void setAttribute(int, bool) {}
  void* createSprite(int width, int height) { pixels_.resize(width * height); return pixels_.data(); }
  void deleteSprite() { pixels_.clear(); }
  void fillSprite(uint16_t color) { std::fill(pixels_.begin(), pixels_.end(), color); }
  void setTextColor(uint16_t color, uint16_t = 0) { textcolor = color; }
  void* getPointer() { return pixels_.data(); }
  bool getSwapBytes() const { return swap_; }
  void setSwapBytes(bool swap) { swap_ = swap; }
  void pushImage(int x, int y, int w, int h, uint16_t* data) {
    for (int iy = std::max(0, -y); iy < std::min(h, 240-y); ++iy)
      for (int ix = std::max(0, -x); ix < std::min(w, 320-x); ++ix) {
        uint16_t c = data[iy*w+ix];
        drawPixel(x+ix, y+iy, swap_ ? c : uint16_t((c << 8) | (c >> 8)));
      }
  }
  void pushSprite(int x, int y) { pushSprite(x, y, 0, 0, 320, 240); }
  bool pushSprite(int x, int y, int sx, int sy, int w, int h) {
    ++display_->transfers; display_->bytes += w * h * 2;
    for (int iy = 0; iy < h; ++iy)
      for (int ix = 0; ix < w; ++ix)
        display_->pixels[(y+iy)*320+x+ix] = pixels_.at((sy+iy)*320+sx+ix);
    return true;
  }
  void drawPixel(int x, int y, uint16_t color) { if (x >= 0 && x < 320 && y >= 0 && y < 240 && !pixels_.empty()) pixels_[y * 320 + x] = color; }
  uint16_t readPixel(int x, int y) { return pixels_.at(y * 320 + x); }
  void drawLine(int x, int y, int, int, uint16_t color) { drawPixel(x, y, color); }
  void drawRect(int x, int y, int, int, uint16_t color) { drawPixel(x, y, color); }
  void fillRect(int x, int y, int w, int h, uint16_t color) { for (int i = 0; i < h; ++i) for (int j = 0; j < w; ++j) drawPixel(x+j, y+i, color); }
  void drawCircle(int x, int y, int, uint16_t color) { drawPixel(x, y, color); }
  void fillCircle(int x, int y, int r, uint16_t color) { for (int i = -r; i <= r; ++i) for (int j = -r; j <= r; ++j) if (i*i+j*j <= r*r) drawPixel(x+j, y+i, color); }
};
