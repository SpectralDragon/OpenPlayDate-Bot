"""Build an original NROM test: colour tiles, scrolling, joypad and battery RAM.

No third-party game code or assets. Zero-page $01 contains the controller bits
(A, B, SELECT, START, UP, DOWN, LEFT, RIGHT); $6000 counts launches.
"""
import argparse
from pathlib import Path


def make_rom(pal=False):
    code, labels, fixups = bytearray(), {}, []

    def emit(*values):
        code.extend(values)

    def label(name):
        labels[name] = 0x8000 + len(code)

    def branch(op, name):
        emit(op, 0)
        fixups.append((len(code)-1, name, True))

    def jump(op, name):
        emit(op, 0, 0)
        fixups.append((len(code)-2, name, False))

    label('reset')
    emit(0x78, 0xD8, 0xA2, 0xFF, 0x9A)  # SEI, CLD, LDX #255, TXS
    emit(0xA9, 0, 0x8D, 0, 0x20, 0x8D, 1, 0x20, 0x85, 0, 0x85, 1)
    emit(0xEE, 0, 0x60)  # INC saved launch count
    for name in ('vblank1', 'vblank2'):
        label(name)
        emit(0x2C, 2, 0x20)  # BIT PPUSTATUS
        branch(0x10, name)  # BPL
    # Write 32 palette entries.
    emit(0xA9, 0x3F, 0x8D, 6, 0x20, 0xA9, 0, 0x8D, 6, 0x20, 0xA2, 0)
    label('palette_loop')
    jump(0xBD, 'palette')  # LDA palette,X
    emit(0x8D, 7, 0x20, 0xE8, 0xE0, 32)
    branch(0xD0, 'palette_loop')
    # Fill 960 nametable tiles, then 64 attribute bytes.
    emit(0xA9, 0x20, 0x8D, 6, 0x20, 0xA9, 0, 0x8D, 6, 0x20)
    emit(0xA0, 3, 0xA2, 0)
    label('tiles')
    emit(0x8A, 0x29, 3, 0x8D, 7, 0x20, 0xE8)
    branch(0xD0, 'tiles')
    emit(0x88)
    branch(0xD0, 'tiles')
    label('last_tiles')
    emit(0x8A, 0x29, 3, 0x8D, 7, 0x20, 0xE8, 0xE0, 192)
    branch(0xD0, 'last_tiles')
    emit(0xA9, 0, 0xA2, 64)
    label('attributes')
    emit(0x8D, 7, 0x20, 0xCA)
    branch(0xD0, 'attributes')
    emit(0xA9, 0, 0x8D, 5, 0x20, 0x8D, 5, 0x20)
    emit(0xA9, 0x80, 0x8D, 0, 0x20, 0xA9, 0x0A, 0x8D, 1, 0x20)
    label('forever')
    jump(0x4C, 'forever')
    label('nmi')
    emit(0x48, 0x8A, 0x48)  # Save A,X
    emit(0xE6, 0, 0xA5, 0, 0x29, 0x1F, 0x8D, 5, 0x20)
    emit(0xA9, 0, 0x8D, 5, 0x20)
    emit(0xA9, 1, 0x8D, 0x16, 0x40, 0xA9, 0, 0x8D, 0x16, 0x40, 0x85, 1)
    emit(0xA2, 8)
    label('buttons')
    emit(0xAD, 0x16, 0x40, 0x4A, 0x66, 1, 0xCA)
    branch(0xD0, 'buttons')
    emit(0x68, 0xAA, 0x68, 0x40)  # Restore X,A; RTI
    label('irq')
    emit(0x40)
    label('palette')
    emit(*([0x0F, 0x16, 0x2A, 0x21] * 8))
    for offset, name, relative in fixups:
        target = labels[name]
        if relative:
            delta = target - (0x8000 + offset + 1)
            assert -128 <= delta <= 127
            code[offset] = delta & 255
        else:
            code[offset:offset+2] = target.to_bytes(2, 'little')
    prg = bytearray([0xEA] * 16384)
    prg[:len(code)] = code
    for offset, name in ((0x3FFA, 'nmi'), (0x3FFC, 'reset'), (0x3FFE, 'irq')):
        prg[offset:offset+2] = labels[name].to_bytes(2, 'little')
    chr_data = bytearray(8192)
    for tile in range(4):
        for row in range(8):
            chr_data[tile*16+row] = 0xFF if tile & 1 else 0
            chr_data[tile*16+row+8] = 0xFF if tile & 2 else 0
    header = bytearray(b'NES\x1A' + bytes([1, 1, 2, 0, 1, int(pal)]) + bytes(6))
    return bytes(header + prg + chr_data)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path, nargs='?', default=Path('.pio/inspection/openplay-test.nes'))
    parser.add_argument('--pal', action='store_true')
    args = parser.parse_args()
    args.destination.parent.mkdir(parents=True, exist_ok=True)
    args.destination.write_bytes(make_rom(args.pal))
    print(f'Created original NES test cartridge: {args.destination}')
