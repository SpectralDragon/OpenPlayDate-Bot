"""Build the desktop simulator from the real firmware Lua runtime (no board needed)."""
import concurrent.futures
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
BUILD = ROOT / "ide/native/build"


def main():
    BUILD.mkdir(parents=True, exist_ok=True)
    cc, cxx = os.environ.get("CC", "clang"), os.environ.get("CXX", "clang++")
    for compiler in (cc, cxx):
        if not shutil.which(compiler):
            sys.exit(f"Compiler not found: {compiler}. Install LLVM or set CC/CXX.")
    json_dir = ROOT / ".pio/libdeps/robot-eyes/ArduinoJson/src"
    if not (json_dir / "ArduinoJson.h").exists():
        sys.exit("ArduinoJson missing. Run tools/pio.ps1 run once from the repository root.")
    includes = ["-I" + str(p) for p in (ROOT / "ide/native", ROOT / "tests/native", ROOT / "include", ROOT / "lib/Lua/src", json_dir)]
    flags = ["-O2", "-D_CRT_SECURE_NO_WARNINGS", "-DLUAI_MAXCCALLS=40", "-DOPENPLAY_DESKTOP", *includes]

    def compile_c(source):
        output = BUILD / (source.stem + ".o")
        subprocess.run([cc, "-std=c11", *flags, "-c", str(source), "-o", str(output)], check=True)
        return str(output)

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        objects = list(pool.map(compile_c, sorted((ROOT / "lib/Lua/src").glob("*.c"))))
    output = BUILD / ("openplay-simulator.exe" if sys.platform == "win32" else "openplay-simulator")
    sources = [ROOT / p for p in ("src/opd_bundle.cpp", "src/lua_app.cpp", "src/ui_text.cpp", "ide/native/simulator.cpp")]
    subprocess.run([cxx, "-std=c++17", *flags, *map(str, sources), *objects, "-o", str(output)], check=True)
    print(f"Built: {output}")


if __name__ == "__main__":
    main()
