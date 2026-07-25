# organUI

Local web and watch bridge for the Opus-Two OSC interface.

## Run

```powershell
npm install
node server.js
```

By default, organUI discovers an Opus-Two controller on the local network. It
broadcasts the non-destructive OSC refresh command on every active IPv4 subnet,
then directs subsequent commands to the first controller that returns valid OSC
feedback. If that controller stops responding, discovery resumes automatically.

- OSC command port: `8000`
- OSC feedback port: `9000`
- HTTP port: `3000`

The ports can be configured in `conf.json` with `oscSendPort`,
`oscListenPort`, and `httpPort`, or overridden at runtime with:

- `OPUS_OSC_SEND_PORT`
- `OPUS_OSC_LISTEN_PORT`
- `ORGANUI_HTTP_PORT`

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

The backend validates outgoing OSC address families and values before sending
them. Unsupported or malformed requests to `POST /api/osc` return HTTP 400.
