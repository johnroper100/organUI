# organUI

Local organ control and monitoring gateway. The current release includes the
Opus Two adapter; the Fugara integration and capability model are
control-system neutral.

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

organUI reports its organ adapters, capabilities, normalized organ state, and
uptime to Fugara with an outbound HTTPS heartbeat. This works through normal
church NAT and firewall setups: it does not require port forwarding, a
public/static IP address, or any inbound connection to the church network.

Adapters are status inputs and control outputs used by the general Organ UI
server. A control system is one possible adapter, not a requirement. An organ
without a control system can use a sensor/contact-closure adapter, and a future
installation can combine several adapters:

```json
{
  "organ": {
    "integrationMode": "control-and-monitor",
    "adapters": [
      {
        "id": "opus-two-primary",
        "adapter": "opus-two",
        "kind": "control-system",
        "manufacturer": "Opus Two",
        "model": ""
      }
    ]
  }
}
```

Organ on/off reporting separately tracks control power and blower power. The
default uses the live controller API connection for control power and ignores
blower power:

```json
{
  "organ": {
    "powerSensing": {
      "control": "controller-api",
      "blower": "ignore",
      "combine": "separate"
    }
  }
}
```

Set either metric to `ignore` when it is not meaningful for an installation.
Control power may use `controller-api` or `power-probe`; blower power may use
`power-probe`. Select a specific locally discovered Plenum power probe with
`controlProbe` or `blowerProbe`:

```json
{
  "organ": {
    "powerSensing": {
      "control": "power-probe",
      "controlProbe": "PW-1111-2222-3333",
      "blower": "power-probe",
      "blowerProbe": "PW-4444-5555-6666",
      "combine": "separate"
    }
  }
}
```

When only one power probe is discovered, it is selected automatically if the
configured serial is blank. OrganUI has no native current-sensor input. With
both metrics included, `any` considers the organ on when either input is on,
while `all` requires both.
Use `combine: "separate"` (or `false`) when both metrics should be reported
independently without also reporting a single resolved “organ on” state.

`integrationMode` is `control-and-monitor` when organUI is the site's primary
control surface, or `monitor-only` when the manufacturer's control surface
remains primary and organUI mainly reports operational data. An adapter supplies
its default monitoring and control capabilities. Configuration may override
them with each adapter's `capabilities.monitoring` and `capabilities.control`;
monitor-only profiles never advertise control capabilities.

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
device from the client's Overview page. Fugara records normalized organ-state
events regardless of which adapter observed them, and organUI sends transitions
immediately rather than waiting for the next scheduled heartbeat. The startup
heartbeat is sent before OrganUI starts its web and discovery services. If
OrganUI heartbeats stop, Fugara marks the site connection unreachable while
retaining the last controller/probe power observation as a separate metric.
When the OSC controller connects, organUI waits for that controller session's
fresh uptime feedback before reporting the controller as on, so the connected
event and its uptime are recorded together.

The heartbeat uses schema version 2. Its `services` list describes the general
roles hosted by Organ UI, while generic organ fields and adapters describe how
this instrument is observed or controlled. Every adapter identifies its kind,
capabilities, and isolated `extensions` object. See
[`docs/fugara-integration.md`](docs/fugara-integration.md) for the contract and
the planned remote-command boundary.

## Local probes

Plenum temperature/humidity and power probes send historical data directly to
Fugara. They also broadcast the latest reading on UDP port `47612`. organUI
listens to that independent local stream and provides an on-site dashboard at
`/probes`; Fugara availability is not required to view current readings.

```json
{
  "probes": {
    "localBroadcastEnabled": true,
    "localBroadcastPort": 47612
  }
}
```

Set `PROBE_BROADCAST_PORT` to override the port. The read-only
`GET /api/probes` endpoint and `probeReadings` Socket.IO event expose the latest
validated reading per serial number. A reading becomes stale after three
reported update intervals (with a 60-second minimum).

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
- `/probes` for locally broadcast temperature and humidity readings
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
