# organUI implementation review

Reviewed July 25, 2026.

## Executive summary

This is a useful proof of concept and already covers most of the old TouchOSC
surface through OSC. The Node process acts as the required UDP-to-browser
bridge, keeps a shared state cache, and serves separate organist and technician
views. The technician view reproduces the eight main TouchOSC pages surprisingly
closely.

It is not yet a production-ready replacement:

1. The separate Opus-Two Remote UDP API (port 5005, Eframe chamber 108) is not
   implemented.
2. The browser controls use touch-only events and can miss release events. That
   is dangerous for held notes and other momentary controls.
3. Any device that can reach the Node server can submit arbitrary OSC addresses
   and values.
4. Several layouts are tablet-oriented rather than phone-oriented.
5. Feedback coverage is partial, so some controls do not reflect the console's
   actual state.
6. Broader integration testing and operator documentation are still
   prototype-level.

The best next step is to harden and test the existing OSC bridge before adding
the Remote UDP API.

## Material reviewed

- `docs/OPTICS_layout_v1.20.touchosc`
- `docs/OSC_Client_Protocol_Reference.txt`
- `docs/Opus-Two_Remote_UDP_API.md`
- `docs/opus-two-procedure-reference.docx`
- `docs/organist+manual+3_25_22.pdf`
- `docs/messageLogUniqueVals.txt`
- The Node, HTML, CSS, configuration, and Apple Watch implementation

The procedure reference is primarily for writing controller configuration
modules. It explains the semantics of stops, pistons, ranges, expressions, and
user variables, but it does not add another client transport. The organist
manual is especially relevant to safety: recording immediately replaces a
track, tracks are protected by default, and changing piston ranges is a
specialized operation.

## What is implemented

### OSC bridge

`server.js` currently provides:

- An OSC client sending to the configured console, defaulting to UDP port 8000
  (`server.js:50`).
- An OSC feedback listener defaulting to UDP port 9000 (`server.js:51`).
- Registration/refresh using `/OPTICS/special2001` at startup, on each browser
  connection, and every 30 minutes (`server.js:149`, `server.js:375`,
  `server.js:487-488`).
- Parsing and caching for stops, stop labels, division labels, the 25 tuner
  notes, tuner controls, 12 pistons, pitch/coupler controls, expressions,
  naming, track selection, track copy, and user variables.
- Socket.IO fan-out of console state to all connected browsers.
- Socket.IO commands from browsers back to OSC.
- An HTTP `POST /api/osc` bridge used by the watch app (`server.js:445-453`).

This architecture is appropriate for browsers. Browsers cannot open the UDP
sockets needed by OSC or the Remote UDP API, so a local bridge service is
required.

### Browser UI

The technician page covers nearly all of the original TouchOSC organization:

- Four stop pages covering stops 1-252 and division labels 1-36.
- A 25-key tuner keyboard, pitch/coupler controls, Magic Tuner, sostenuto, and
  piston controls.
- Track/folder naming through the controller's virtual-keyboard OSC commands.
- Expression controls.
- Track selection, protection, record, play, and stop.
- Track-copy and paged user-variable controls.

The organist page is a reduced view with two site-specific controls, track
transport, and naming.

Vue and Bootstrap are served locally, which is good for an instrument LAN that
may have no Internet access.

### Apple Watch

The watch-only SwiftUI app sends Back and Next through `POST /api/osc`. It
normalizes the configured server URL and correctly sends a press followed by a
release. It is a useful focused remote, although its server address is compiled
into the app.

## Protocol coverage and gaps

| Area | Status | Notes |
|---|---|---|
| OSC command transport, UDP 8000 | Implemented | One OSC message per `node-osc` send, as required. |
| OSC feedback, UDP 9000 | Partly implemented | The main UI state is handled, but several documented feedback addresses are ignored. |
| OSC registration | Implemented | Uses the documented rule that any inbound OSC message registers the sender IP. |
| Remote UDP API, UDP 5005 | Not implemented | No SSDP enrollment, Eframe codec, command socket, reply decoder, timeout handling, or browser facade exists. |
| Device vibration | Not implemented | `/vibrate` feedback is ignored; it could map to supported device haptics. |
| Direct API queries/renames | Not implemented | Folder/track queries, OLED dump, direct rename, direct go-to, and acknowledgments are unavailable. |

### Missing OSC feedback handling

The server ignores at least these documented feedback values:

- `/RP/label328` - folder number
- `/RP/label329` - memory level
- `/RP/label330` and `/RP/label331` - separate minute/second values
- `/RP/label340` - transposer state
- `/OPTICS/special1999/color` - piston Set state
- `/OPTICS/special2014/color` and `2015/color` - Back/Next flash state
- `/OPTICS/special2016/color` - held/touch state
- `/OPTICS/special2035/color` and `2036/color` - record/play state
- `/vibrate`

Only piston feedback 1900-1911 is cached, although the protocol supports
1900-1998. That may be an intentional UI limit, but it should be configuration
rather than a parser limit.

### Remote UDP API work remaining

Implement a dedicated module rather than adding this framing logic to
`server.js`:

1. Send an SSDP `NOTIFY` enrollment approximately every five seconds so the
   client is a known entity.
2. Encode and decode the 14-byte RTP/Eframe header.
3. Use UDP port 5005 and chamber byte 108.
4. Maintain sequence and timestamp fields.
5. Validate the payload limit of 49 bytes.
6. Parse `OK`, `Value Out of Range`, `Bad Rename`, `Track Locked`, `Busy`,
   `Fldr`, `Tk`, and the four `LDSL` replies.
7. Add per-command timeouts. Silence can mean an unknown command or an unknown
   sender, so timeout errors should say that explicitly.
8. Expose typed server operations rather than accepting arbitrary strings.

Useful UI features unlocked by that work include native-text folder/track
renaming, direct go-to folder/level/track, OLED mirroring, track/folder name
queries, and explicit success/error feedback.

`Dev Reset` should be technician-only and require a deliberate confirmation.

## Correctness and safety findings

### P0 - replace touch-only handlers

Nearly every control uses only `touchstart` and `touchend`, for example
`tuner.html:90-224`. This excludes mouse/keyboard control and, more importantly,
does not handle `touchcancel`, a finger leaving the control, page visibility
changes, or a dropped connection. A release can therefore be lost for
momentary controls such as tuner notes and special 2016.

Use Pointer Events (`pointerdown`, `pointerup`, `pointercancel`, and
`lostpointercapture`) with pointer capture. Add a central release-all routine
for `visibilitychange`, Socket.IO disconnect, navigation, and window blur.
Ordinary latch controls only need the press edge, but sending a release remains
harmless.

### P0 - restrict control input

`sendOSCcmd` and `POST /api/osc` originally accepted any non-empty address and
any number. They now validate the existing OSC command families, object ranges,
finite values, and fader bounds before sending. A reachable client can still
operate those commands because authentication has not yet been added.

Add:

- A typed command allowlist with numeric ranges and state validation.
- Authentication suitable for the trusted LAN (at minimum a configured token
  or pairing PIN).
- Separate organist and technician permissions.
- Origin checks for Socket.IO.
- Request body and rate limits.
- A network deployment note telling installers not to expose port 3000 outside
  the instrument LAN.

High-impact operations such as Record, track copy, unlock, piston Set/range, and
device reset should use hold-to-confirm or a confirmation step. The manual
states that Record immediately erases the current track.

### P1 - resolve two protocol inconsistencies on real hardware

The generated OSC reference says `/faders/fader<n>` is 1-based, but the supplied
TouchOSC file sends `fader0` through `fader7`. The current server follows the
TouchOSC behavior by sending the Vue array index (`server.js:413-442`).

Also, one section describes user-page feedback as `/UserDef/page`, while the
feedback table, TouchOSC file, and server use `/UserDef/page1`.

Capture packets from a known working console or test both forms before changing
either behavior. Turn the result into an automated compatibility test and
correct the reference document if necessary.

### P1 - add connection health

The server caches the last uptime forever. A disconnected controller can
therefore continue to look connected. Track the last valid OSC packet time,
publish `connecting/online/stale/offline`, and disable dangerous UI controls
while offline. Show the console IP and last feedback time in a technician
diagnostics panel.

### P1 - complete state feedback

Normalize colors and numeric strings into typed state in one protocol adapter.
The UI should show actual Set, Play, Record, Back/Next, transposer, folder, and
memory-level state rather than only the last locally requested action.

### P1 - fix dead and unfinished routes

- `organist.html` contains a `page == 3` track-copy/user-variable view, but its
  navigation only selects pages 0-2. It is unreachable.
- `/sequencer` is registered in `server.js:467-469`, but `sequencer.html` does
  not exist and the route returns 404.
- `file-system-db`, `database.json`, and the `db` instance are unused.
- `numFolders`, `numLevels`, and `numTracks` in `conf.json` are unused.

Remove intentionally abandoned code or finish and document it.

## Mobile and accessibility review

The viewport metadata and Bootstrap breakpoints are a good start, but the
technician screen still assumes tablet-like width.

Main phone problems:

- Each stop page always renders nine equal columns. At phone width, stop names
  and tap targets become too narrow (`tuner.html:232-266`).
- The 25-key piano uses fixed 48 px natural keys and has no deliberate
  horizontal scrolling or responsive scaling (`static/css/style.css:25-57`).
- The naming keyboard is dozens of fixed, individually-authored buttons. It
  wraps unpredictably on narrow screens.
- Track-copy controls and five user-variable columns are too dense for phones.
- The vertical range input uses the non-standard `orient="vertical"` behavior.
- Global `user-select: none` blocks selection everywhere, including status and
  diagnostic text.

Recommended mobile design:

- Make the organist view the primary phone experience and the full technician
  view an adaptive tablet/desktop workspace.
- On phones, render one division at a time or a 2-column stop list with a
  division selector instead of nine columns.
- Put the tuner keyboard in a clearly scrollable region, or scale it based on
  the viewport.
- Use a native text field and mobile keyboard for naming, translating characters
  to `specialkb` only when the UDP API is unavailable.
- Use CSS Grid with explicit phone/tablet/desktop breakpoints.
- Respect safe-area insets and offer an installable PWA manifest.
- Consider Screen Wake Lock for technician sessions, with a visible toggle.

Accessibility work:

- Tuner keys are `div` elements with no role, name, focus, or keyboard support.
- Toggle state is conveyed mostly by color and lacks `aria-pressed`.
- There is no live connection/status announcement.
- The global light font-weight rule reduces legibility.
- All interactive targets should be at least about 44 by 44 CSS pixels.

## Performance and maintainability

### Avoid full-state broadcasts for every small update

Stop label/color updates still broadcast the full 253-element stop array, but
the backend now coalesces repeated events of the same type within an event-loop
turn. Fader input still sends on every input event and broadcasts the whole
expression array.

Send item-level patches, batch the initial OSC refresh into one snapshot, and
throttle faders to a reasonable update rate. Keep a versioned full snapshot for
new browser connections.

### Separate protocol, state, and presentation

`server.js` is a long address-dispatch chain, and `organist.html` duplicates
large sections of `tuner.html`. A maintainable structure would have:

- `config` - validated runtime configuration
- `osc-client` - OSC send/receive and address validation
- `opus-remote-client` - SSDP and chamber-108 UDP API
- `state-store` - normalized typed state and patch events
- `http/socket-server` - authenticated browser facade
- Shared Vue components for transport, naming, stops, tuner, and user variables

Generate repetitive controls from command metadata instead of hand-writing
hundreds of event handlers.

### Runtime configuration

The Node console IP and ports now have validated config-file/environment
overrides while retaining the old defaults. The watch server remains hardcoded
in `apple-watch-remote/OrganRemoteWatch/RemoteConfiguration.swift`.

Support validated environment/config-file values and provide a first-run setup
page or documented example configuration. Do not require rebuilding the watch
app for every installation.

### Dependencies

The installed production tree currently reports 12 known vulnerabilities,
including 8 high-severity findings, mostly in the old Express and Socket.IO
trees. Update dependencies deliberately and retest OSC/Socket.IO behavior.

The watch app permits arbitrary insecure HTTP loads. A local HTTP exception may
be practical on an isolated instrument LAN, but narrow it instead of enabling
all arbitrary loads, and add the appropriate local-network usage description.

## Testing and operations missing

The package now has initial validation/parser tests through `npm test`, but no
linting, CI, full bridge integration suite, or hardware acceptance guide. Add:

1. Unit tests for every OSC feedback address and color conversion.
2. Golden-byte tests for Eframe encode/decode.
3. Remote API response parser tests, including four-part OLED replies.
4. A mock UDP console for integration tests on ports other than 8000/9000/5005.
5. Browser interaction tests for press, release, cancel, disconnect, and
   reconnect.
6. Responsive checks at common phone, small tablet, and landscape tablet sizes.
7. A short real-console smoke-test checklist.
8. Graceful shutdown that closes HTTP, OSC, API, and SSDP sockets.
9. Structured logs and a diagnostics endpoint that does not expose control
   capability.

The current HTTP pages return 200, while `/sequencer` returns 404.
`node --check server.js` passes.

## Suggested delivery order

### Phase 1 - make current OSC control safe and dependable

- Move addresses/ports to validated configuration.
- Add command schemas, authorization, and rate limits.
- Convert touch handlers to safe Pointer Events with release-all behavior.
- Add connection health and complete the documented feedback parser.
- Fix or remove unreachable/missing views.
- Update dependencies.
- Add protocol and mock-console tests.

### Phase 2 - implement the Remote UDP API

- Add SSDP enrollment and the Eframe codec.
- Add typed command/reply operations with timeouts.
- Expose only approved operations to each UI role.
- Replace virtual naming with native text entry and acknowledgments.
- Add direct folder/level/track navigation and optional OLED mirroring.

### Phase 3 - finish the mobile product

- Refactor shared Vue components.
- Redesign technician pages for phone/tablet breakpoints.
- Add PWA installation, safe-area support, accessibility, and optional wake lock.
- Make the watch server configurable and add connection/pairing status.
- Run the real-console acceptance matrix.

## Overall assessment

The core architectural choice is sound, and the tuner page has already done
most of the tedious TouchOSC mapping work. Treat it as a strong prototype, not
as a rewrite. The fastest route to a dependable product is to preserve that
mapping, put a typed and tested protocol layer underneath it, then adapt the UI
for phones and add the second UDP API as a separate client module.
