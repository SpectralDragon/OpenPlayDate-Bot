#include <algorithm>
#include <array>
#include <cassert>
#include <fstream>
#include <iterator>
#include <set>
#include <vector>
#include "nes_cartridge.h"
#include "nes_video.h"
extern "C" {
#include <nes/nes.h>
}

static std::vector<uint8_t> read(const char* path) {
  std::ifstream file(path, std::ios::binary);
  assert(file);
  return {std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>()};
}

static nes_t* load(std::vector<uint8_t>& rom, bool pal = false) {
  nescartridge::Header header;
  assert(!nescartridge::parse(rom.data(), rom.size(), header));
  nes_t* nes = nes_init(pal ? SYS_NES_PAL : SYS_NES_NTSC, 11025, false, nullptr);
  assert(nes);
  rom_t* cart = rom_loadmem(rom.data(), rom.size());
  assert(cart && nes_insertcart(cart) == 0);
  return nes;
}

static void validation(const std::vector<uint8_t>& fixture) {
  nescartridge::Header header;
  auto h = fixture;
  assert(!nescartridge::parse(h.data(), h.size(), header));
  assert(header.mapper == 0 && header.battery && !header.pal);
  assert(header.prgBytes == 16384 && header.chrBytes == 8192);
  h[0] = 0; assert(nescartridge::parse(h.data(), h.size(), header)); h = fixture;
  h[7] = 8; assert(nescartridge::parse(h.data(), h.size(), header)); h = fixture;
  h[7] = 1; assert(nescartridge::parse(h.data(), h.size(), header)); h = fixture;
  h[6] |= 4; assert(nescartridge::parse(h.data(), h.size(), header)); h = fixture;
  h[6] |= 0x50; assert(nescartridge::parse(h.data(), h.size(), header)); h = fixture;
  h[4] = 0; assert(nescartridge::parse(h.data(), h.size(), header)); h = fixture;
  h[12] = 'D'; assert(nescartridge::parse(h.data(), h.size(), header)); h = fixture;
  h[8] = 2; assert(nescartridge::parse(h.data(), h.size(), header)); h = fixture;
  assert(nescartridge::parse(h.data(), h.size()-1, header));
  assert(nescartridge::parse(h.data(), h.size()+1, header));
  assert(nescartridge::parse(h.data(), 15, header));
  assert(nescartridge::parse(h.data(), nescartridge::maxRomSize+1, header));
}

static void controller() {
  for (int state = 0; state < 256; ++state) {
    input_update(0, state);
    input_write(0x4016, 1);
    for (int i = 0; i < 40; ++i) assert((input_read(0x4016) & 1) == (state & 1));
    input_write(0x4016, 0);
    int expected = state;
    if ((expected & 0x30) == 0x30) expected &= ~0x30;
    if ((expected & 0xC0) == 0xC0) expected &= ~0xC0;
    for (int bit = 0; bit < 8; ++bit) assert((input_read(0x4016) & 1) == ((expected >> bit) & 1));
    for (int i = 0; i < 100; ++i) assert((input_read(0x4016) & 1) == 1);
  }
}

static void video() {
  std::vector<uint8_t> before(nesvideo::frameBytes), after(before);
  uint16_t colors[64];
  for (int i = 0; i < 64; ++i) colors[i] = uint16_t(i * 997);
  assert(!nesvideo::findDamage(after.data(), before.data(), true).count);
  for (int y : {0, 7, 8, 231, 239}) {
    for (int x = 0; x < 256; ++x) {
      after = before;
      after[y*272+8+x] = 17;
      auto damage = nesvideo::findDamage(after.data(), before.data(), true);
      assert(damage.count == 1);
      auto rect = damage.rects[0];
      assert(rect.y <= y && rect.y + rect.h > y && rect.h == 8);
      std::vector<uint16_t> stripe(rect.w * rect.h);
      nesvideo::stripe(after.data(), rect, colors, stripe.data());
      for (int dest = 0; dest < 320; ++dest) {
        const bool changed = (dest*256/320 == x);
        assert((dest >= rect.x && dest < rect.x+rect.w) == changed);
        if (changed) assert(stripe[(y-rect.y)*rect.w+dest-rect.x] == colors[17]);
      }
    }
  }
  after = before; after[0] = 9; after[271] = 9;
  assert(!nesvideo::findDamage(after.data(), before.data(), true).count);
  after[8] = 0xC0;  // Priority flags never change the displayed colour.
  assert(!nesvideo::findDamage(after.data(), before.data(), true).count);
  const auto full = nesvideo::findDamage(before.data(), nullptr, false);
  assert(full.count == 30 && full.rects[29].y == 232 && full.rects[29].w == 320);
}

static void mappers() {
  for (int mapper : {0, 1, 2, 3, 4, 7, 9, 10, 11, 66}) {
    const size_t prg = mapper == 0 ? 32768 : 65536;
    const size_t chr = mapper == 0 ? 8192 : 32768;
    std::vector<uint8_t> rom(16+prg+chr);
    rom[0]='N'; rom[1]='E'; rom[2]='S'; rom[3]=0x1A;
    rom[4]=prg/16384; rom[5]=chr/8192;
    rom[6]=(mapper & 15) << 4; rom[7]=mapper & 0xF0;
    for (size_t i = 0; i < prg; ++i) rom[16+i] = uint8_t(0x10 + i/8192);
    for (size_t i = 0; i < chr; ++i) rom[16+prg+i] = uint8_t(0x20 + i/8192);
    auto* nes = load(rom);
    assert(nes->cart->mapper_number == mapper);
    assert(nes->cart->prg_ram && nes->cart->chr_ram && !nes->cpu->jammed);
    if (mapper == 2) {
      mem_putbyte(0x8000, 1); assert(mem_getbyte(0x8000) == 0x12);
      assert(mem_getbyte(0xC000) == 0x16);
    } else if (mapper == 4) {
      mem_putbyte(0x8000, 6); mem_putbyte(0x8001, 2);
      assert(mem_getbyte(0x8000) == 0x12);
    } else if (mapper == 7 || mapper == 66) {
      mem_putbyte(0x8000, mapper == 7 ? 1 : 0x10);
      assert(mem_getbyte(0x8000) == 0x14);
    } else if (mapper == 3) {
      mem_putbyte(0x8000, 1); assert(nes->ppu->page[0][0] == 0x21);
    }
    nes_shutdown();
    nes_shutdown();  // Failure cleanup is safe after core-owned cleanup too.
  }
}

int main(int argc, char** argv) {
  assert(argc == 4);
  auto rom = read(argv[1]);
  validation(rom); video(); mappers();
  std::array<uint8_t, 8192> saved{};
  for (bool pal : {false, true}) {
    rom = read(pal ? argv[2] : argv[1]);
    auto* nes = load(rom, pal);
    assert(nes->refresh_rate == (pal ? 50 : 60));
    controller();
    std::vector<uint8_t> frame(nesvideo::frameBytes);
    nes_setvidbuf(frame.data());
    input_update(0, NES_PAD_A | NES_PAD_START | NES_PAD_RIGHT);
    for (int i = 0; i < 30; ++i) nes_emulate(true);
    assert(!nes->cpu->jammed && nes->mem->ram[0] >= 20);
    assert(nes->mem->ram[1] == (NES_PAD_A | NES_PAD_START | NES_PAD_RIGHT));
    assert(nes->cart->prg_ram[0] == 1);
    std::set<int> pixels;
    for (int y = 16; y < 224; ++y)
      for (int x = 8; x < 248; ++x) pixels.insert(frame[y*272+8+x] & 63);
    assert(pixels == std::set<int>({0x0F, 0x16, 0x2A, 0x21}));
    if (!pal) {
      std::ofstream picture(argv[3], std::ios::binary);
      picture << "P6\n256 240\n255\n";
      for (int y = 0; y < 240; ++y) for (int x = 0; x < 256; ++x) {
        const uint8_t p = frame[y*272+8+x] & 63;
        const uint8_t rgb[] = {uint8_t(p==0x16 ? 240 : 0), uint8_t(p==0x2A ? 240 : 0), uint8_t(p==0x21 ? 240 : 0)};
        picture.write(reinterpret_cast<const char*>(rgb), 3);
      }
    }
    std::copy(nes->cart->prg_ram, nes->cart->prg_ram+8192, saved.begin());
    nes_shutdown();
    nes = load(rom, pal);
    std::copy(saved.begin(), saved.end(), nes->cart->prg_ram);
    nes_setvidbuf(frame.data());
    for (int i = 0; i < 10; ++i) nes_emulate(true);
    assert(nes->cart->prg_ram[0] == 2);
    nes_shutdown();
  }
  puts("PASS: iNES validation, 10 mappers, bank switching, joypad, NTSC/PAL frames, colour output, battery RAM reload, video damage/scaling");
}
