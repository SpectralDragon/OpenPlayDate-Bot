# OpenPlay Studio LAN protocol 1

Firmware starts HTTP/UDP services when connected to the saved Wi-Fi network,
or while its explicit setup AP is open. Disabling Wi-Fi/disconnecting stops
services. Game Boy and NES stop the radio; Lua programs leave the network available.
The AP no longer owns the lifetime of the HTTP server on the station interface.
Wi-Fi modem sleep is disabled while the network is enabled, so ARP, discovery
and HTTP remain responsive; Game Boy and NES explicitly stop the radio.

## Discovery

Studio binds a temporary UDP/IPv4 socket and sends the exact ASCII datagram
`OPENPLAY_DISCOVER_V1` to port **42420**, to the limited broadcast address and
each LAN adapter's directed broadcast address. The console replies to the
sender's IP and port with its `/api/info` JSON. Discovery contains no token.
Each loop processes at most one bounded datagram.

The client uses the **actual packet sender**, never an advertised hostname,
then verifies each candidate through HTTP. Duplicate device IDs are merged.
The last address and `192.168.4.1` are also probed directly, so remembered or
manually entered addresses work without UDP. Public addresses, credentials in
URLs, paths and redirects are not accepted by the desktop client.

## HTTP

- `GET /api/info`: JSON with `product: "OpenPlay"`, `protocol: 1`, `api: 1`,
  stable device `id` derived from its MAC, `name`, `port: 80`, `storage` and
  `maxBundle: 2097152`.
- `GET /api/studio`: same identity plus a boot-scoped 24-hex-digit `token`.
  Requires `X-OpenPlay-Studio: 1` and no `Origin` header. No CORS allowance;
  a browser at another origin cannot obtain the session through a simple GET
  or an allowed preflight. Replies have `Cache-Control: no-store`.
- `POST /api/apps?token=...`: multipart form with exactly one `opd` file;
  filename is `<manifest.id>.opd`. Also requires the custom Studio header
  and no Origin. Uses the existing staged upload, size and bundle validator.
  A valid upload replaces the same filename only after validation.

Before accepting the upload, the shell shuts down an existing Lua application
and releases GPIO/UART, closing the bundle before its file can be replaced.
An active Game Boy or NES cartridge prevents preparation. After successful commit, the shell starts the
uploaded Lua application. `200` means the main chunk and `init` succeeded:

```json
{"ok":true,"running":true,"file":"bouncing-ball.opd","bytes":1363}
```

Validation/storage errors return `400` and `{ "ok": false, "error": "…" }`.
Launch errors return `422`; the valid bundle remains stored and the console
shows its normal Lua error screen. Unauthorized requests receive `403`.
The response is not a promise that later `update`/`draw` calls will succeed.

Studio checks the selected stable ID against the fresh session to catch DHCP
address reuse, sends at most 2 MiB with multipart framing, and requires an
exact file/byte count plus `running: true` before showing success. Transfer
progress stops at 90% until that acknowledgement. Tokens stay in the main
process and are never sent to the renderer or logged.

The setup browser routes `/wifi`, `/rom` and `/opd` require the explicit AP
portal to be active; enabling LAN deployment doesn't expose Wi-Fi mutation
through those routes during normal station operation. This protocol trusts
the local network: it is HTTP and does not implement per-computer pairing,
TLS, OTA firmware flashing, or arbitrary native code installation. A machine
on the same network can use the Studio API to install/run Lua applications.

Tests: `cd ide; npm test; npm run test:ui` (isolated UDP/HTTP test console).
Build firmware with `tools/pio.ps1 run`, then update a console once by USB to
enable these endpoints; subsequent application uploads use the network.

Hardware verification: AI-S3 / ESP32-S3 on COM6, `robot-eyes`, ST7789 320×240.
The updated firmware rejoined its saved LAN at `192.168.3.32`; discovery and
HTTP identification succeeded. The unmodified `bouncing-ball` example was
deployed twice in succession (1349-byte OPD1), including replacement while
the previous Lua application was active. Each response acknowledged the
matching filename/byte count and successful launch. Serial status confirmed
`lua_playing`, `LUA: active=1`, mounted storage and active HTTP/UDP services.
