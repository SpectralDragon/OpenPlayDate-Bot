"""Dump the device's current menu or displayed Game Boy frame as a PPM image."""
import argparse
import time
from pathlib import Path
import serial


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    port = serial.Serial()
    port.port, port.baudrate, port.timeout = args.port, 115200, 0.25
    port.dtr = port.rts = False
    port.open()
    try:
        port.reset_input_buffer()
        port.write(b'v')
        port.flush()
        deadline = time.monotonic() + 8
        header = b''
        while header != b'P6\n' and time.monotonic() < deadline:
            header = port.readline()
            if b'SCREEN: eyes' in header:
                raise RuntimeError('Open a menu or a game before capturing')
        if header != b'P6\n':
            raise RuntimeError('The device did not return a screenshot')
        dimensions, depth = port.readline(), port.readline()
        width, height = map(int, dimensions.split())
        if depth != b'255\n' or width not in (160, 320) or height not in (144, 240):
            raise RuntimeError('Invalid image header')
        pixels = bytearray()
        deadline = time.monotonic() + 15
        while len(pixels) < width * height * 3 and time.monotonic() < deadline:
            pixels.extend(port.read(width * height * 3 - len(pixels)))
        if len(pixels) != width * height * 3:
            raise RuntimeError('Incomplete screenshot')
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(header + dimensions + depth + pixels)
        print(f'Captured {width}x{height}: {args.output}')
    finally:
        port.close()


if __name__ == '__main__':
    main()
