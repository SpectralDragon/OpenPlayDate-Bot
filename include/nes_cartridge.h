#pragma once
#include <stddef.h>
#include <stdint.h>

// Validate before handing untrusted uploads to the emulator's iNES loader.
namespace nescartridge {
constexpr size_t maxRomSize = 2 * 1024 * 1024;
struct Header {
  unsigned mapper = 0;
  size_t prgBytes = 0, chrBytes = 0;
  bool battery = false, pal = false;
};
inline const char* parse(const uint8_t* h, size_t size, Header& out) {
  if (size < 16 || size > maxRomSize) return "Нужен .nes размером до 2 МБ";
  if (h[0] != 'N' || h[1] != 'E' || h[2] != 'S' || h[3] != 0x1A)
    return "Нужен картридж NES в формате iNES";
  if ((h[7] & 0x0C) != 0) return "Поддерживается iNES 1.0, без NES 2.0";
  if (h[7] & 3) return "Картриджи VS System и PlayChoice не поддерживаются";
  if (h[6] & 4) return "Картриджи с trainer пока не поддерживаются";
  // Reject ambiguous legacy headers rather than misidentify a mapper.
  for (int i = 10; i < 16; ++i)
    if (h[i]) return "Нужен стандартный заголовок iNES 1.0";
  out.mapper = (h[6] >> 4) | (h[7] & 0xF0);
  switch (out.mapper) {
    case 0: case 1: case 2: case 3: case 4: case 7: case 9: case 10: case 11: case 66: break;
    default: return "Этот тип картриджа NES пока не поддерживается";
  }
  out.prgBytes = size_t(h[4]) * 16384;
  out.chrBytes = size_t(h[5]) * 8192;
  if (!out.prgBytes || size != 16 + out.prgBytes + out.chrBytes)
    return "Размер NES ROM не совпадает с заголовком";
  if (h[8] > 1) return "Расширенная RAM картриджа пока не поддерживается";
  if (out.mapper == 0 && (h[4] > 2 || h[5] > 1)) return "Неверный размер картриджа NROM";
  out.battery = (h[6] & 2) != 0;
  out.pal = (h[9] & 1) != 0;
  return nullptr;
}
}
