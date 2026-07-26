# organUI

Local web and watch bridge for Opus-Two controllers.

## Run

```powershell
npm install
node server.js
```

organUI uses the controller's remote UDP API as its primary command transport.
It listens for the controller's SSDP announcements and advertises itself as an
`Opus-Two API` entity every five seconds. Commands covered by that API—such as
stop toggles, recording, track movement, direct track playback, full-text
track/folder renaming, and direct folder selection—use UDP. Faders, tuning
controls, the dedicated Stop control, and other features not covered by the
remote API continue to use OSC.

Discovery does not require a fixed controller address:

1. A controller learned from its SSDP announcement is preferred.
2. A controller returning valid OSC feedback is the live fallback.
3. `oscHost`/`OPUS_OSC_HOST`, when supplied, is used only if neither discovery
   mechanism has found a controller.

If a discovered controller stops announcing/responding, discovery resumes
automatically.

After connecting, organUI probes the read-only track-name and folder-name
commands and the range-checked local-level command to discover the controller's
capacities. The prior local memory level is restored after the bounded probes.
The `numTracks`, `numFolders`, and `numLevels` values in `conf.json` are retained
as fallbacks when those probes time out or the controller is unavailable.
Successful discovery writes the current values back to `conf.json`, keeping
those fallbacks synchronized with the most recently connected controller.

- Opus-Two remote UDP command/reply port: `5005`
- SSDP discovery port/group: `1900` / `239.255.255.250`
- OSC command port: `8000`
- OSC feedback port: `9000`
- HTTP port: `3000`

The ports can be configured in `conf.json` with `udpPort`, `oscSendPort`,
`oscListenPort`, and `httpPort`, or overridden at runtime with:

- `OPUS_UDP_PORT`
- `OPUS_OSC_SEND_PORT`
- `OPUS_OSC_LISTEN_PORT`
- `ORGANUI_HTTP_PORT`

## Fugara monitoring

organUI can report the console's on/off state and uptime to Fugara with an
outbound HTTPS heartbeat. This works through normal church NAT and firewall
setups: it does not require port forwarding, a public/static IP address, or any
inbound connection to the church network.

Set the public Fugara heartbeat URL in `conf.json`:

```json
{
  "fugara": {
    "telemetryUrl": "https://app.fugara.tech/api/organ-ui/heartbeat",
    "heartbeatSeconds": 60
  }
}
```

The same settings can be supplied as `FUGARA_TELEMETRY_URL` and
`FUGARA_HEARTBEAT_SECONDS`. On first start, organUI creates
`fugara-device.json`, containing a random device ID and authentication token.
Keep that file private and persistent; copying or deleting it creates a
different Fugara device identity. `FUGARA_DEVICE_IDENTITY_PATH` can place it in
a persistent application-data directory.

Once its first heartbeat reaches Fugara, link the newly discovered organUI
device from the client's Overview page. Fugara records a state event whenever
the Opus-Two controller begins or stops returning OSC feedback, and organUI
sends those transitions immediately rather than waiting for the next scheduled
heartbeat. This assumes the organUI server remains powered while the console's
physical switch controls the organ controller. If organUI heartbeats stop,
Fugara reports the site connection as unreachable instead of claiming that the
organ is off, since a network or organUI power failure cannot be distinguished
remotely.

Discovery uses IPv4 broadcasts and therefore requires organUI and the
controller to be on the same broadcast network. For a controller on a different
routed subnet, set `oscHost` in `conf.json` or use `OPUS_OSC_HOST` as an
explicit override.

If multiple controllers answer discovery, organUI uses the first one that
responds and ignores feedback from the others until the selected controller
goes offline.

## Test

```powershell
npm test
```

The browser UI is available at:

- `/organist` for performance controls
- `/tuner` for tuning, stops, naming, and recorder controls
- `/advanced` for complete OSC-family and remote UDP command coverage

The Advanced page is intentionally a direct protocol test surface. Its
controls can change stops, memory, playback, recording, and console state.

The backend validates both transports before sending. Unsupported or malformed
requests to `POST /api/osc` or `POST /api/udp` return HTTP 400. The UDP endpoint
accepts high-level actions rather than arbitrary controller strings, for
example:

```json
{"action":"playTrack","number":42}
```

```json
{"action":"renameTrack","number":42,"name":"Sunday Postlude"}
```
