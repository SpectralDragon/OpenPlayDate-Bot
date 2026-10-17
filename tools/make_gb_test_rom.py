"""Create our own tiny DMG test cartridge; contains no third-party ROM data.

The background scrolls four shades. Cartridge RAM counts boots, reversing
the palette every other boot so battery save/load can be checked visually.
"""
from pathlib import Path
import argparse


def make_rom(scene='scroll'):
    if scene not in ('scroll', 'tile'):
        raise ValueError('scene must be scroll or tile')
    rom = bytearray(32768)
    rom[0x100:0x104] = bytes([0x00, 0xC3, 0x50, 0x01])
    rom[0x134:0x140] = b'OPENPLAYTEST' if scene == 'scroll' else b'OPENPLAYTILE'
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
    ])
    if scene == 'tile':
        code += bytes([
            0x21, 0x10, 0x80, 0x06, 16, 0xAF,  # Blank tile 1
            0x22, 0x05, 0x20, 0xFC,
            0x21, 0, 0x98, 0x01, 0, 4,        # Map: 1024 blank tiles
            0x3E, 1, 0x22, 0x0B, 0x78, 0xB1, 0x20, 0xF8,
            0xAF, 0xEA, 0x8A, 0x98,           # One patterned tile at (80,32)
        ])
    code += bytes([
        0x3E, 0x91, 0xE0, 0x40,       # LCD on
        0xF0, 0x44, 0xFE, 144, 0x20, 0xFA,  # Wait for VBlank
        0xF0, 0x43, 0x3C,             # Scroll
    ])
    if scene == 'tile':
        code += bytes([0xE6, 0x3F])   # Keep the small moving patch in view
    code += bytes([
        0xE0, 0x43,
        0xF0, 0x44, 0xFE, 144, 0x28, 0xFA,  # Leave VBlank
        0x18, 0xED if scene == 'scroll' else 0xEB,
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
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path, nargs='?', default=Path('.pio/inspection/openplay-test.gb'))
    parser.add_argument('--scene', choices=('scroll', 'tile'), default='scroll')
    args = parser.parse_args()
    destination = args.destination
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(make_rom(args.scene))
    print(f'Created test cartridge: {destination} ({destination.stat().st_size} bytes)')
