#include "ui_text.h"
#include "ui_font_data.h"

void uiText(TFT_eSprite& target, const String& text, int x, int y,
            uint16_t color, bool large, int right) {
  const auto* glyphs = large ? uiGlyphs22 : uiGlyphs14;
  const auto* bits = large ? uiBits22 : uiBits14;
  const int count = sizeof(uiGlyphs14) / sizeof(UiGlyph);
  const int height = large ? 27 : 19;
  const auto* cursor = reinterpret_cast<const uint8_t*>(text.c_str());
  while (*cursor) {
    uint16_t code = *cursor++;
    if ((code & 0xE0) == 0xC0 && (*cursor & 0xC0) == 0x80)
      code = ((code & 31) << 6) | (*cursor++ & 63);
    const UiGlyph* found = nullptr;
    for (int i = 0; i < count; ++i) {
      if (glyphs[i].code == code) { found = &glyphs[i]; break; }
    }
    if (!found) continue;
    if (x + found->width > right) break;
    for (int row = 0; row < height; ++row) {
      for (int col = 0; col < found->width; ++col) {
        const int bit = row * found->width + col;
        if (bits[found->offset + bit / 8] & (0x80 >> (bit % 8)))
          target.drawPixel(x + col, y + row, color);
      }
    }
    x += found->width;
  }
}
