"""Create our own tiny DMG test cartridge; contains no third-party ROM data.

The background scrolls four shades. Cartridge RAM counts boots, reversing
the palette every other boot so battery save/load can be checked visually.
"""
from pathlib import Path
import sys


def make_rom():
    rom = bytearray(32768)
    rom[0x100:0x104] = bytes([0x00, 0xC3, 0x50, 0x01])
    rom[0x134:0x140] = b'OPENPLAYTEST'
    rom[0x147] = 3  # MBC1 + RAM + battery
    rom[0x149] = 2  # 8 KiB RAM
    code = bytes([
        0xF3,                         # DI
        0xAF, 0xE0, 0x40,             # LCD off
        0x3E, 0x0A, 0xEA, 0, 0,       # Cartridge RAM enabled
        0xFA, 0, 0xA0, 0x3C,          # Increment saved boot count
        0xEA, 0, 0xA0,
        0xE6, 1, 0x28, 4,             # Alternate palette
        0x3E, 0x1B, 0x18, 2,
        0x3E, 0xE4, 0xE0, 0x47,
        0x21, 0, 0x80, 0x06, 8,       # One 8x8 tile, four vertical shades
        0x3E, 0xAA, 0x22,
        0x3E, 0xCC, 0x22,
        0x05, 0x20, 0xF7,
        0x3E, 0x91, 0xE0, 0x40,       # LCD on
        0xF0, 0x44, 0xFE, 144, 0x20, 0xFA,  # Wait for VBlank
        0xF0, 0x43, 0x3C, 0xE0, 0x43,       # Scroll
        0xF0, 0x44, 0xFE, 144, 0x28, 0xFA,  # Leave VBlank
        0x18, 0xED,
    ])
    rom[0x150:0x150+len(code)] = code
    checksum = 0
    for value in rom[0x134:0x14D]:
        checksum = (checksum - value - 1) & 255
    rom[0x14D] = checksum
    checksum = (sum(rom[:0x14E]) + sum(rom[0x150:])) & 65535
    rom[0x14E:0x150] = checksum.to_bytes(2, 'big')
    return bytes(rom)


if __name__ == '__main__':
    destination = Path(sys.argv[1] if len(sys.argv) > 1 else '.pio/inspection/openplay-test.gb')
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(make_rom())
    print(f'Created test cartridge: {destination} ({destination.stat().st_size} bytes)')
