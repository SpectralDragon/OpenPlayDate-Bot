"""Compile and exercise the real Lua engine and firmware adapters on the host.

Requires clang/clang++ (or pass --cc/--cxx). Hardware doubles live in tests/native.
No device is opened or flashed. Run the PlatformIO build first for ArduinoJson.
"""
import argparse
import concurrent.futures
import json
import shutil
import struct
import subprocess
import sys
from pathlib import Path
import opd

ROOT = Path(__file__).resolve().parents[1]


def fixtures(storage):
    apps = storage / "apps"
    apps.mkdir(parents=True, exist_ok=True)
    game = {"api": 1, "id": "test", "name": "Test", "kind": "game", "entry": "main.lua"}
    robot = {**game, "kind": "robot", "permissions": {"gpio": [16], "uart": {"port": 1, "tx": 17, "rx": 18, "baud": 9600}}}

    def save(name, script, manifest=game, extra=None):
        (apps / f"{name}.opd").write_bytes(opd.encode_bundle(manifest, {"main.lua": script.encode(), **(extra or {})}))

    for name in ("bouncing-ball", "robot-ports"):
        opd.pack(ROOT / "examples" / name, apps / f"{name}.opd")
    save("contract", """
assert(io == nil and os == nil and debug == nil and package == nil)
assert(load == nil and loadfile == nil and dofile == nil and pcall == nil)
assert(coroutine == nil and setmetatable == nil and getmetatable == nil)
assert(opd.gpio == nil and opd.uart == nil)
assert(opd.apiVersion == 1 and opd.width == 320 and opd.height == 240)
assert(require('lib.state') == require('lib.state'))
assert(opd.assets.read('assets/data') == 'a' .. string.char(0, 255))
local frame = 0
return {
  update = function(dt)
    frame = frame + 1
    assert(dt >= 0 and dt <= 0.25)
    if frame == 1 then assert(not opd.input.down('a')) end
    if frame == 2 then
      assert(opd.input.pressed('a') and opd.input.released('a'))
      assert(not opd.input.down('a') and opd.input.axis('x') == 0)
      assert(opd.input.pressed('right') and opd.input.released('right'))
    end
    if frame == 3 then
      assert(not opd.input.pressed('a') and not opd.input.released('a'))
      opd.system.exit()
    end
  end,
  draw = function()
    opd.graphics.clear(0)
    opd.graphics.image('assets/pixel.opi', 1, 1)
  end
}
""", extra={"lib/state.lua": b"return {}", "assets/data": b"a\x00\xff",
            "assets/pixel.opi": struct.pack("<4sHHH", b"OPI1", 1, 1, 0xF800)})
    save("loop-init", "while true do end")
    save("memory", "return string.rep('a', 600000)")
    save("bad-error", "error({})")
    save("long-error", "error(string.rep('x', 300000))")
    save("nul-error", "error(string.char(0))")
    save("circular", "require('a'); return {}", extra={"a.lua": b"require('b')", "b.lua": b"require('a')"})
    save("deep", "return " + "(" * 100 + "{}" + ")" * 100)
    # Binary chunks intentionally bypass the source-only SDK guard to test firmware.
    save("bytecode", "return {}")
    raw = (apps / "bytecode.opd").read_bytes()
    (apps / "bytecode.opd").write_bytes(raw[:-9] + b"\x1bLua" + b"\0" * 5)
    setup = "opd.gpio.mode(16,'output'); opd.gpio.write(16,true); opd.uart.open(); "
    save("loop-update", setup + "return {update=function() while true do end end}", robot)
    save("pin-denied", setup + "return {update=function() opd.gpio.mode(4,'output') end}", robot)
    save("bad-callback", setup + "return {update=true}", robot)
    save("pause-error", setup + "return {pause=function() error('pause failed') end}", robot)
    save("shutdown-error", setup + "return {shutdown=function() error('shutdown failed') end}", robot)
    save("paused-shutdown", setup + "return {shutdown=function() opd.gpio.mode(16,'output') end}", robot)
    save("memory-update", "return {update=function() local x=string.rep('a',600000) end}")

    def raw_bundle(manifest, entries):
        raw_manifest = json.dumps(manifest, separators=(",", ":")).encode()
        raw = bytearray(struct.pack("<4sII", b"OPD1", len(raw_manifest), len(entries)) + raw_manifest)
        for path, data in entries:
            raw.extend(struct.pack("<HI", len(path), len(data)) + path.encode() + data)
        return bytes(raw)

    good = raw_bundle(game, [("main.lua", b"return {}")])
    bad = {
        "truncated": good[:-1], "trailing": good + b"x",
        "traversal": raw_bundle(game, [("../main.lua", b"return {}")]),
        "duplicate": raw_bundle(game, [("main.lua", b"return {}"), ("main.lua", b"return {}")]),
        "missing-entry": raw_bundle(game, [("a.lua", b"return {}")]),
        "bad-pin": raw_bundle({**robot, "permissions": {"gpio": [4]}}, [("main.lua", b"return {}")]),
        "bad-uart": raw_bundle({**robot, "permissions": {"uart": {"port": 0, "tx": 17, "rx": 18, "baud": 9600}}}, [("main.lua", b"return {}")]),
        "bad-api": raw_bundle({**game, "api": 2}, [("main.lua", b"return {}")]),
    }
    for name, data in bad.items():
        (apps / f"{name}.opd").write_bytes(data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cc", default="clang")
    parser.add_argument("--cxx", default="clang++")
    args = parser.parse_args()
    build = ROOT / ".pio/native-lua"
    build.mkdir(parents=True, exist_ok=True)
    includes = ["-I" + str(ROOT / path) for path in (
        "tests/native", "include", "lib/Lua/src", ".pio/libdeps/robot-eyes/ArduinoJson/src")]
    if not (ROOT / ".pio/libdeps/robot-eyes/ArduinoJson/src/ArduinoJson.h").exists():
        parser.error("Run tools/pio.ps1 run first to install ArduinoJson")
    for compiler in (args.cc, args.cxx):
        if not shutil.which(compiler):
            parser.error(f"Compiler unavailable: {compiler}")

    def compile_c(source):
        output = build / (source.stem + ".o")
        subprocess.run([args.cc, "-std=c11", "-O1", "-D_CRT_SECURE_NO_WARNINGS", "-DLUAI_MAXCCALLS=40",
                        *includes, "-c", str(source), "-o", str(output)], check=True, cwd=build)
        return str(output)

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        objects = list(pool.map(compile_c, sorted((ROOT / "lib/Lua/src").glob("*.c"))))
    executable = build / ("runtime_test.exe" if sys.platform == "win32" else "runtime_test")
    subprocess.run([args.cxx, "-std=c++17", "-O1", "-D_CRT_SECURE_NO_WARNINGS", *includes,
                    *[str(ROOT / path) for path in ("src/opd_bundle.cpp", "src/lua_app.cpp", "src/ui_text.cpp", "tests/native/runtime_test.cpp")],
                    *objects, "-o", str(executable)], check=True, cwd=build)
    fixtures(build / "storage")
    subprocess.run([str(executable), str(build / "storage")], check=True, timeout=20)


if __name__ == "__main__":
    main()
