import copy
import os
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import opd


class BundleTests(unittest.TestCase):
    def setUp(self):
        self.manifest = {"api": 1, "id": "test", "name": "Тест", "kind": "game", "entry": "main.lua"}
        self.files = {"main.lua": b"return {}", "assets/a.bin": b"\x00\xff\x01"}

    def test_roundtrip_deterministic(self):
        data = opd.encode_bundle(self.manifest, self.files)
        self.assertEqual(data, opd.encode_bundle(self.manifest, dict(reversed(list(self.files.items())))))
        self.assertEqual((self.manifest, self.files), opd.decode_bundle(data))

    def test_every_truncated_prefix_is_rejected(self):
        data = opd.encode_bundle(self.manifest, self.files)
        for end in range(len(data)):
            with self.subTest(end=end), self.assertRaises(ValueError):
                opd.decode_bundle(data[:end])

    def test_bad_header_counts_trailing_data(self):
        good = opd.encode_bundle(self.manifest, self.files)
        cases = [b"ZIP!" + good[4:], good + b"x", good[:4] + struct.pack("<I", 4097) + good[8:],
                 good[:8] + struct.pack("<I", 65) + good[12:]]
        for data in cases:
            with self.assertRaises(ValueError):
                opd.decode_bundle(data)

    def test_traversal_and_invalid_names(self):
        for path in ("../main.lua", "a/../x.lua", "/main.lua", "C:/a", "a\\b", "a//b", "a/./b", "a\0b", "а.lua", "a/"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                opd.encode_bundle(self.manifest, {**self.files, path: b"x"})

    def test_scripts_entry_limits(self):
        for files in ({"other.lua": b"return {}"}, {"main.lua": b""}, {"main.lua": b"x" * 65537},
                      {"main.lua": b"\x1bLua"}, {**self.files, "big": bytes(opd.MAX_BUNDLE)},
                      {**self.files, **{f"x{i}": b"x" for i in range(64)}}):
            with self.assertRaises(ValueError):
                opd.encode_bundle(self.manifest, files)

    def test_robot_pin_policy(self):
        robot = {**self.manifest, "kind": "robot", "permissions": {
            "gpio": [16], "uart": {"port": 1, "tx": 17, "rx": 18, "baud": 9600}}}
        opd.validate_manifest(robot)
        changes = [("gpio", [4]), ("gpio", [19]), ("gpio", [26]), ("gpio", [16, 16]),
                   ("gpio", [True]), ("gpio", [17]), ("uart", {"port": 0, "tx": 17, "rx": 18, "baud": 9600}),
                   ("uart", {"port": 1, "tx": 17, "rx": 17, "baud": 9600}),
                   ("uart", {"port": 1, "tx": 17, "rx": 18, "baud": 0}), ("camera", True)]
        for key, value in changes:
            broken = copy.deepcopy(robot)
            broken["permissions"][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                opd.validate_manifest(broken)
        robot["kind"] = "game"
        with self.assertRaises(ValueError):
            opd.validate_manifest(robot)

    def test_duplicate_path_and_json_key(self):
        data = opd.encode_bundle(self.manifest, self.files)
        record = struct.pack("<HI", 8, 9) + b"main.lua" + b"return {}"
        data = data[:8] + struct.pack("<I", 3) + data[12:] + record
        with self.assertRaises(ValueError):
            opd.decode_bundle(data)
        with self.assertRaises(ValueError):
            opd.read_json(b'{"api": 1, "api": 2}')

    def test_pack_examples_and_output_location(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory:
            for example in ("bouncing-ball", "robot-ports"):
                target = Path(directory) / f"{example}.opd"
                opd.pack(root / "examples" / example, target)
                manifest, files = opd.decode_bundle(target.read_bytes())
                self.assertIn(manifest["entry"], files)
                result = subprocess.run([sys.executable, str(root / "tools/opd.py"), "inspect", str(target)],
                                        capture_output=True, encoding="utf-8", check=True,
                                        env={**os.environ, "PYTHONIOENCODING": "ascii"})
                self.assertIn(manifest["name"], result.stdout)
            with self.assertRaises(ValueError):
                opd.pack(root / "examples/bouncing-ball", root / "examples/bouncing-ball/bad.opd")

    def test_image_byte_order_and_whitespace_pixels(self):
        pixels = b"\xff\x00\x00\x00\xff\x00\x00\x00\xff\x0a\x20\x0d"
        result = opd.ppm_to_opi(b"P6\n# demo\n4 1\n255\n" + pixels)
        self.assertEqual(result[:8], struct.pack("<4sHH", b"OPI1", 4, 1))
        self.assertEqual(result[8:14], b"\x00\xf8\xe0\x07\x1f\x00")
        self.assertEqual(len(result), 16)
        for bad in (b"P3 1 1 255\n", b"P6 321 1 255\n", b"P6 1 1 255\n\x00"):
            with self.assertRaises(ValueError):
                opd.ppm_to_opi(bad)


if __name__ == "__main__":
    unittest.main()
