#pragma once
#include <TFT_eSPI.h>

// Draws UTF-8 Russian and ASCII with a bounded right edge.
void uiText(TFT_eSprite& target, const String& text, int x, int y,
            uint16_t color, bool large = false, int right = 308);
