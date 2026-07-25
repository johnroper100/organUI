# organUI

Local web and watch bridge for the Opus-Two OSC interface.

## Run

```powershell
npm install
node server.js
```

The existing defaults are preserved:

- Opus-Two console: `192.168.50.78`
- OSC command port: `8000`
- OSC feedback port: `9000`
- HTTP port: `3000`

The transport can be configured in `conf.json` with `oscHost`,
`oscSendPort`, `oscListenPort`, and `httpPort`, or overridden at runtime with:

- `OPUS_OSC_HOST`
- `OPUS_OSC_SEND_PORT`
- `OPUS_OSC_LISTEN_PORT`
- `ORGANUI_HTTP_PORT`

## Test

```powershell
npm test
```

The backend validates outgoing OSC address families and values before sending
them. Unsupported or malformed requests to `POST /api/osc` return HTTP 400.
