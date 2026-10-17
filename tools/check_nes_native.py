"""Build and test the production NES core, cartridge validator and video adapter.

Uses original test cartridges. No device is opened or flashed.
"""
import argparse
import concurrent.futures
from pathlib import Path
import shutil
import subprocess
import sys
from make_nes_test_rom import make_rom


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cc', default='clang')
    parser.add_argument('--cxx', default='clang++')
    args = parser.parse_args()
    if not shutil.which(args.cc) or not shutil.which(args.cxx):
        parser.error('Install clang/clang++ or specify --cc and --cxx')
    root = Path(__file__).resolve().parents[1]
    build = root / '.pio/native-nes'
    build.mkdir(parents=True, exist_ok=True)
    source = root / 'lib/Nofrendo/src'
    includes = ['-I'+str(source), '-I'+str(root/'include')]
    objects = []

    def compile_c(path):
        obj = build / (path.parent.name + '_' + path.stem + '.o')
        subprocess.run([args.cc, '-std=gnu99', '-O2', '-Wno-format', *includes,
                        '-c', str(path), '-o', str(obj)], check=True)
        return obj

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        objects = list(pool.map(compile_c, sorted(source.rglob('*.c'))))
    exe = build / ('nes_test.exe' if sys.platform == 'win32' else 'nes_test')
    subprocess.run([args.cxx, '-std=c++17', '-O2', *includes,
                    str(root/'tests/native/nes_test.cpp'), *map(str, objects), '-o', str(exe)], check=True)
    for pal in (False, True):
        (build / ('pal.nes' if pal else 'ntsc.nes')).write_bytes(make_rom(pal))
    subprocess.run([str(exe), str(build/'ntsc.nes'), str(build/'pal.nes'),
                    str(build/'nes-test.ppm')], check=True, timeout=30)


if __name__ == '__main__':
    main()
