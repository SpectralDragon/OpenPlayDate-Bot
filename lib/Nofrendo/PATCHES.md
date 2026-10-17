OpenPlay vendors the NES core, palettes, and mappers 0, 1, 2, 3, 4, 7, 9,
10, 11, and 66 from the commit in UPSTREAM.txt. The upstream launcher,
state files, debugger, ROM database, other mappers, and documentation are
omitted. Original per-file copyright and license notices are preserved.
COPYING is the upstream license file. COPYING.LIB additionally includes the
GNU Library GPL v2 text referenced by the core's source notices, from
https://www.gnu.org/licenses/old-licenses/lgpl-2.0.txt.

Local changes:

- A PlatformIO manifest and a mapper table for the supported subset.
- ROM loading uses the validated iNES header without database overrides.
  A truncated ROM is rejected instead of merely logging a warning.
- APU initialization reports allocation failure.
- The host logging adapter preserves an existing `IRAM_ATTR` definition.
- Controller reads honor the strobe, saturate after eight bits, and reset
  the strobe between cartridges, avoiding oversized shifts.

OpenPlay loads ROMs from LittleFS into PSRAM, drives the core one frame at
a time, and saves battery RAM through its own checked temporary-file path.
The upstream standalone launcher and its file persistence are not used.
