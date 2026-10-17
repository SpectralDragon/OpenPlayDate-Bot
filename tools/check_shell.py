"""Hardware smoke test for the shell. Requires pyserial and a connected console.

Does not change saved settings or start games. Optionally captures the menu.
"""
import argparse
import re
import time
from pathlib import Path
import serial


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', required=True)
    parser.add_argument('--screenshot', type=Path)
    args = parser.parse_args()
    port = serial.Serial()
    port.port, port.baudrate, port.timeout = args.port, 115200, 0.15
    port.dtr = port.rts = False
    port.open()

    def query(commands=''):
        port.reset_input_buffer()
        port.write((commands + 's').encode())
        port.flush()
        end = time.monotonic() + 0.5
        output = bytearray()
        while time.monotonic() < end:
            output.extend(port.read(4096))
        text = output.decode('utf-8', errors='replace')
        assert 'ready=1 test=0' in text, text
        assert 'Guru Meditation' not in text, text
        match = re.search(r'SHELL: page=(\w+) selected=(\d+)', text)
        assert match, text
        return match.group(1), int(match.group(2))

    try:
        initial, _ = query()
        if initial in ('playing', 'paused', 'portal', 'lua_playing', 'lua_paused'):
            raise RuntimeError('Close the game or Wi-Fi setup before running the test')
        for commands, expected in [
            ('z', ('eyes', 0)), ('a', ('home', 0)),
            ('b', ('eyes', 0)), ('m', ('home', 0)),
            ('j', ('home', 1)), ('a', ('apps', 0)),
            ('b', ('home', 0)), ('jj', ('home', 2)), ('a', ('settings', 0)),
            ('j', ('settings', 1)), ('k', ('settings', 0)),
            ('b', ('home', 0)), ('a', ('games', 0)),
            ('b', ('home', 0)), ('k', ('home', 3)),
            ('a', ('eyes', 0)), ('m', ('home', 0)),
        ]:
            actual = query(commands)
            assert actual == expected, (commands, expected, actual)
        if args.screenshot:
            port.reset_input_buffer()
            port.write(b'v')
            port.flush()
            deadline = time.monotonic() + 5
            header = b''
            while header != b'P6\n' and time.monotonic() < deadline:
                header = port.readline()
            assert header == b'P6\n', header
            dimensions, depth = port.readline(), port.readline()
            width, height = map(int, dimensions.split())
            assert (width, height) == (320, 240)
            output = bytearray()
            while len(output) < width * height * 3:
                data = port.read(width * height * 3 - len(output))
                assert data, 'Incomplete screenshot'
                output.extend(data)
            args.screenshot.parent.mkdir(parents=True, exist_ok=True)
            args.screenshot.write_bytes(header + dimensions + depth + output)
        assert query('z') == ('eyes', 0)
        print('PASS: wake, back, menu navigation, wraparound, program list, standby')
    finally:
        port.close()


if __name__ == '__main__':
    main()
