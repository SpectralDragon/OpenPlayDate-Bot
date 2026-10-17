"""Measure emulation and actual LCD update FPS of the currently running GB game.

Requires pyserial. Only sends status queries: does not start, pause or save a game.
Works with old firmware counters and the new GAMEBOY_VIDEO diagnostics.
"""
import argparse
import json
import re
import sys
import time
from pathlib import Path
import serial


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", required=True)
    parser.add_argument("--seconds", type=float, default=10)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if not 1 <= args.seconds <= 300:
        parser.error("--seconds must be between 1 and 300")
    port = serial.Serial()
    port.port, port.baudrate, port.timeout = args.port, 115200, 0.05
    port.dtr = port.rts = False

    def sample():
        port.reset_input_buffer()
        begin = time.monotonic()
        port.write(b"s"); port.flush()
        output = bytearray()
        while time.monotonic() - begin < 0.4:
            output.extend(port.read(8192))
            if b"SYSTEM:" in output:
                break
        text = output.decode("utf-8", errors="replace")
        if "page=playing " not in text:
            raise RuntimeError("Start a Game Boy game before measuring; close the pause menu")
        frames = re.search(r"game_frames=(\d+)", text)
        displayed = re.search(r"displayed=(\d+)", text)
        if not frames or not displayed:
            raise RuntimeError("Firmware did not return Game Boy counters")
        return (begin + time.monotonic()) / 2, int(frames[1]), int(displayed[1]), text

    try:
        port.open()
        first = sample()
        deadline = time.monotonic() + args.seconds
        while time.monotonic() < deadline:
            time.sleep(max(0, min(0.2, deadline - time.monotonic())))
        last = sample()
        if last[1] < first[1] or last[2] < first[2]:
            raise RuntimeError("Game restarted or counters wrapped during measurement; retry")
        elapsed = last[0] - first[0]
        result = {"seconds": round(elapsed, 3),
                  "emulation_fps": round((last[1] - first[1]) / elapsed, 2),
                  "display_fps": round((last[2] - first[2]) / elapsed, 2),
                  "initial_status": first[3], "final_status": last[3]}
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
        print(f"Emulation: {result['emulation_fps']:.2f} FPS; LCD updates: {result['display_fps']:.2f} FPS; {elapsed:.2f}s")
        print(last[3].strip())
    finally:
        port.close()


if __name__ == "__main__":
    main()
