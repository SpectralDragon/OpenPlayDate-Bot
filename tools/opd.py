"""OpenPlay SDK: deterministic OPD1 packer, inspector and P6 PPM image converter.

Only the Python standard library is required. See docs/lua-api.md.
"""
import argparse
import json
import re
import struct
import sys
from pathlib import Path

MAX_BUNDLE = 2 * 1024 * 1024
MAX_SCRIPT = 64 * 1024
MAX_FILES = 64
MAX_PATH = 96
AVAILABLE_PINS = frozenset((1, 2, 16, 17, 18, 21))
IDENTIFIER = re.compile(r"[a-z0-9_-]{1,40}\Z", re.ASCII)


def safe_path(value):
    return (isinstance(value, str) and 1 <= len(value) <= MAX_PATH
            and re.fullmatch(r"[A-Za-z0-9_./-]+", value, re.ASCII) is not None
            and all(part not in ("", ".", "..") for part in value.split("/")))


def validate_manifest(manifest):
    def check(condition, message):
        if not condition:
            raise ValueError(message)

    check(isinstance(manifest, dict), "manifest must be a JSON object")
    check(type(manifest.get("api")) is int and manifest["api"] == 1, "api must be 1")
    check(isinstance(manifest.get("id"), str) and IDENTIFIER.fullmatch(manifest["id"]),
          "id: use 1-40 lowercase a-z, 0-9, _ or -")
    check(isinstance(manifest.get("name"), str) and 1 <= len(manifest["name"].encode("utf-8")) <= 80
          and not any(ord(c) < 32 for c in manifest["name"]), "name: 1-80 UTF-8 bytes without control characters")
    check(manifest.get("kind") in ("game", "robot"), "kind must be game or robot")
    check(safe_path(manifest.get("entry")) and manifest["entry"].endswith(".lua"), "entry must be a relative .lua path")
    check(type(manifest.get("fps", 30)) is int and 1 <= manifest.get("fps", 30) <= 60, "fps must be 1-60")
    permissions = manifest.get("permissions", {})
    check(isinstance(permissions, dict) and not permissions.keys() - {"gpio", "uart"}, "unknown permission")
    pins = permissions.get("gpio", [])
    check(isinstance(pins, list) and len(pins) <= 6, "gpio must be an array of at most 6 pins")
    check(all(type(pin) is int and pin in AVAILABLE_PINS for pin in pins), "GPIO unavailable on this board")
    check(len(set(pins)) == len(pins), "duplicate GPIO")
    uart = permissions.get("uart")
    if uart is not None:
        check(isinstance(uart, dict), "uart must be an object")
        check(type(uart.get("port")) is int and uart["port"] == 1, "only UART1 is available")
        check(type(uart.get("baud")) is int and 300 <= uart["baud"] <= 115200, "UART baud must be 300-115200")
        check(all(type(uart.get(key)) is int and uart[key] in AVAILABLE_PINS for key in ("tx", "rx")), "UART pins unavailable")
        check(uart["tx"] != uart["rx"] and uart["tx"] not in pins and uart["rx"] not in pins, "UART/GPIO pin conflict")
    check(manifest["kind"] == "robot" or (not pins and uart is None), "hardware permissions require kind=robot")
    return manifest


def read_json(data):
    def unique_pairs(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"duplicate JSON key: {key}")
            result[key] = value
        return result
    def invalid_constant(value):
        raise ValueError(f"non-JSON constant: {value}")
    return json.loads(data, object_pairs_hook=unique_pairs, parse_constant=invalid_constant)


def encode_bundle(manifest, files):
    validate_manifest(manifest)
    raw = json.dumps(manifest, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    if not 1 <= len(raw) <= 4096 or not 1 <= len(files) <= MAX_FILES:
        raise ValueError("manifest exceeds 4096 bytes, or file count is not 1-64")
    data = bytearray(struct.pack("<4sII", b"OPD1", len(raw), len(files)))
    data.extend(raw)
    if manifest["entry"] not in files:
        raise ValueError("entry does not exist in bundle")
    for path, content in sorted(files.items()):
        if not safe_path(path):
            raise ValueError(f"invalid bundle path: {path}")
        if path.endswith(".lua") and (not 1 <= len(content) <= MAX_SCRIPT or content.startswith(b"\x1b")):
            raise ValueError(f"Lua source must be text, 1 byte to 64 KiB: {path}")
        encoded = path.encode("ascii")
        if len(data) + 6 + len(encoded) + len(content) > MAX_BUNDLE:
            raise ValueError("bundle exceeds 2 MiB")
        data.extend(struct.pack("<HI", len(encoded), len(content)))
        data.extend(encoded)
        data.extend(content)
    return bytes(data)


def decode_bundle(data):
    if not 12 <= len(data) <= MAX_BUNDLE:
        raise ValueError("invalid bundle size")
    magic, manifest_size, count = struct.unpack_from("<4sII", data)
    if magic != b"OPD1" or not 1 <= manifest_size <= 4096 or not 1 <= count <= MAX_FILES:
        raise ValueError("invalid OPD1 header")
    position = 12 + manifest_size
    if position > len(data):
        raise ValueError("truncated manifest")
    manifest = validate_manifest(read_json(data[12:position]))
    files = {}
    for _ in range(count):
        if position + 6 > len(data):
            raise ValueError("truncated file record")
        length, size = struct.unpack_from("<HI", data, position)
        position += 6
        if not 1 <= length <= MAX_PATH or position + length + size > len(data):
            raise ValueError("invalid file bounds")
        path = data[position:position + length].decode("ascii")
        position += length
        if not safe_path(path) or path in files:
            raise ValueError("invalid or duplicate bundle path")
        files[path] = data[position:position + size]
        position += size
        if path.endswith(".lua") and not 1 <= size <= MAX_SCRIPT:
            raise ValueError("Lua source size must be 1 byte to 64 KiB")
    if position != len(data) or manifest["entry"] not in files:
        raise ValueError("trailing data or missing entry")
    return manifest, files


def pack(source, output):
    source = source.resolve(strict=True)
    output = output.resolve()
    if source == output or source in output.parents:
        raise ValueError("write the .opd outside its source directory")
    if output.suffix != ".opd" or not IDENTIFIER.fullmatch(output.stem):
        raise ValueError("output name must use lowercase a-z, 0-9, _ or - and end in .opd")
    manifest_path = source / "manifest.json"
    if manifest_path.is_symlink():
        raise ValueError("manifest cannot be a symlink")
    manifest = read_json(manifest_path.read_bytes())
    files = {}
    for path in sorted(source.rglob("*")):
        relative = path.relative_to(source)
        if any(part.startswith(".") for part in relative.parts):
            continue
        if path.is_symlink():
            raise ValueError(f"symlinks are not supported: {relative}")
        if path.is_file() and path != manifest_path:
            if path.stat().st_size > MAX_BUNDLE:
                raise ValueError(f"file too large: {relative}")
            files[relative.as_posix()] = path.read_bytes()
            if len(files) > MAX_FILES or sum(map(len, files.values())) > MAX_BUNDLE:
                raise ValueError("too many files or bundle exceeds 2 MiB")
    data = encode_bundle(manifest, files)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(data)
    return len(data), len(files)


def ppm_to_opi(data):
    # P6 PPM: comments may occur before any header token.
    position = 0
    tokens = []
    for _ in range(4):
        while position < len(data):
            if data[position] in b" \t\r\n":
                position += 1
            elif data[position] == ord("#"):
                end = data.find(b"\n", position)
                position = len(data) if end < 0 else end + 1
            else:
                break
        start = position
        while position < len(data) and data[position] not in b" \t\r\n":
            position += 1
        tokens.append(data[start:position])
    if tokens[0] != b"P6" or tokens[3] != b"255":
        raise ValueError("expected binary P6 PPM with max value 255")
    width, height = int(tokens[1]), int(tokens[2])
    if not 1 <= width <= 320 or not 1 <= height <= 240:
        raise ValueError("image size must be 1..320 by 1..240")
    if position >= len(data) or data[position] not in b" \t\r\n":
        raise ValueError("missing PPM pixel separator")
    position += 2 if data[position:position + 2] == b"\r\n" else 1
    pixels = data[position:]
    if len(pixels) != width * height * 3:
        raise ValueError("invalid PPM pixel count")
    result = bytearray(struct.pack("<4sHH", b"OPI1", width, height))
    for i in range(0, len(pixels), 3):
        r, g, b = pixels[i:i + 3]
        result.extend(struct.pack("<H", ((r & 248) << 8) | ((g & 252) << 3) | (b >> 3)))
    return bytes(result)


def main():
    # Keep Russian manifest names readable in Windows terminals and pipelines.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    pack_parser = commands.add_parser("pack")
    pack_parser.add_argument("source", type=Path)
    pack_parser.add_argument("output", type=Path)
    inspect_parser = commands.add_parser("inspect")
    inspect_parser.add_argument("bundle", type=Path)
    image_parser = commands.add_parser("image")
    image_parser.add_argument("ppm", type=Path)
    image_parser.add_argument("output", type=Path)
    args = parser.parse_args()
    try:
        if args.command == "pack":
            size, count = pack(args.source, args.output)
            print(f"Packed {count} files, {size} bytes -> {args.output}")
        elif args.command == "inspect":
            manifest, files = decode_bundle(args.bundle.read_bytes())
            print(json.dumps(manifest, ensure_ascii=False, indent=2))
            for path, content in files.items():
                print(f"{len(content):8d}  {path}")
        else:
            args.output.write_bytes(ppm_to_opi(args.ppm.read_bytes()))
            print(f"Image -> {args.output}")
    except (OSError, ValueError, UnicodeError) as error:
        parser.exit(1, f"Error: {error}\n")


if __name__ == "__main__":
    main()
