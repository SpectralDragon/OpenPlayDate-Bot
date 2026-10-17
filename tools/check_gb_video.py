"""Test the production GB mailbox, damage detection and DMA stripe scaler on host."""
import argparse
import shutil
import subprocess
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cxx", default="clang++")
    args = parser.parse_args()
    if not shutil.which(args.cxx):
        parser.error(f"Compiler unavailable: {args.cxx}")
    root = Path(__file__).resolve().parents[1]
    build = root / ".pio/native-gb"
    build.mkdir(parents=True, exist_ok=True)
    executable = build / ("gb_video_test.exe" if sys.platform == "win32" else "gb_video_test")
    subprocess.run([args.cxx, "-std=c++17", "-O2", "-I" + str(root / "include"),
                    str(root / "tests/native/gb_video_test.cpp"), "-o", str(executable)], check=True)
    subprocess.run([str(executable)], check=True, timeout=20)


if __name__ == "__main__":
    main()
