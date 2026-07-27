# Fugara integration boundary

Organ UI is a general on-site monitoring and control server. Fugara communicates
with that server, not directly with an Opus Two or any other manufacturer's wire
protocol. Opus Two control is simply the first adapter implementation.

An adapter can represent a control system, a sensor or contact closure, a
protocol bridge, or another source/output. An organ does not need a control
system, and later releases may combine several adapters to produce one
normalized organ status.

## Installation profile

Every heartbeat contains:

```json
{
  "schemaVersion": 2,
  "services": [
    {
      "id": "organ",
      "capabilities": ["control", "monitoring"]
    },
    {
      "id": "environmental-probes",
      "capabilities": ["local-view"]
    }
  ],
  "organ": {
    "integrationMode": "control-and-monitor",
    "adapters": [
      {
        "id": "opus-two-primary",
        "adapter": "opus-two",
        "kind": "control-system",
        "manufacturer": "Opus Two",
        "model": "",
        "capabilities": {
          "monitoring": ["connection-state", "organ-state", "uptime"],
          "control": ["stops", "tuning"]
        },
        "extensions": {
          "transports": ["osc", "remote-udp"]
        }
      }
    ]
  },
  "organStatus": {
    "observationState": "available",
    "state": "on",
    "uptimeSeconds": 125,
    "uptimeLabel": "2 minutes"
  },
  "powerStatus": {
    "combine": "separate",
    "controlPower": {
      "source": "controller-api",
      "included": true,
      "observationState": "available",
      "state": "on"
    },
    "blowerPower": {
      "source": "ignore",
      "included": false,
      "observationState": "unknown",
      "state": "unknown"
    }
  },
  "organUiStatus": {
    "uptimeSeconds": 900
  }
}
```

The complete heartbeat also carries the Organ UI device ID, pairing code, name,
send time, heartbeat interval, and application version.

`services` describes the roles hosted by the Organ UI server itself. This keeps
the Fugara connection open to services beyond organ control: the current server
can advertise organ monitoring/control and local environmental-probe viewing
independently. Adapter capabilities below `organ` describe how this particular
organ is observed or controlled.

`integrationMode` has two values:

- `control-and-monitor`: Organ UI is intended to provide control and monitoring.
- `monitor-only`: another surface may remain primary, or the available inputs
  may be read-only. Every adapter's control-capability list must be empty.

Fugara gates features from advertised capabilities, never from a manufacturer
name or adapter ID. Data meaningful only to one adapter belongs in that
adapter's `extensions` object.

## Status inputs

`organStatus` is the resolved instrument-level observation, independent of its
source. `observationState` says whether Organ UI currently has enough live input
to make the observation; `state` is `on`, `off`, or `unknown`.

Examples of valid future sources include:

- Opus Two OSC/UDP feedback;
- another manufacturer's monitoring API;
- a current sensor or mains relay;
- GPIO/contact closure tied to the organ's power circuit;
- a manually configured or external automation input.

Resolution policy belongs in Organ UI. Fugara receives one normalized state plus
the adapter inventory needed to explain where features come from.

### Power sensing policy

Organ UI keeps control-system power and blower power as separate observations.
Configure their sources under `organ.powerSensing`:

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

`control` accepts `controller-api`, `power-probe`, or `ignore`. `blower`
accepts `power-probe` or `ignore`. `controlProbe` and `blowerProbe` select the
Plenum power-probe serial used for each metric. If the configured serial is
blank and exactly one power probe is discovered, that probe is selected
automatically. OrganUI does not provide a native current-sensor input.

When both metrics are included, `combine: "any"` reports the organ on when
either circuit is on; it reports off only when both are known to be off.
`combine: "all"` reports on only when both are on and off when either is known
to be off. `combine: "separate"` (or `combine: false`) reports the two metrics
without producing a single organ on/off state. An ignored metric remains
visible as ignored in Fugara but does not participate in the resolved
`organStatus`.

Typical configurations are:

- Control system drives the blower: control `controller-api`, blower `ignore`.
- Blower-only organ: control `ignore`, blower `power-probe`.
- Separately powered control and blower: include both and use `separate`, unless
  the installation specifically needs an `any` or `all` aggregate.

## Other local services

Not every Organ UI data source is an organ-status adapter. Plenum probes are a
separate stream: probes send history directly to Fugara and broadcast current
readings on the LAN. Organ UI listens on UDP `47612` and provides the local
`/probes` dashboard. A power probe only contributes to organ on/off status when
selected by `organ.powerSensing`.

Keeping these domains separate allows one Organ UI process and web application
to host organ control, organ monitoring, and local probe viewing without
conflating their data models.

## Adding an adapter

An organ adapter owns discovery, local transport, state collection, and
translation of common capability actions. Adding one should not change the
Fugara schema. It supplies:

1. a stable adapter ID, kind, and capability defaults;
2. normalized organ-state observations when it is a status source;
3. handlers for each control capability it advertises;
4. an extension document only for data with no useful common representation.

The current runtime implements exactly one `opus-two` adapter and rejects other
runtime configurations rather than silently using the wrong protocol. The
profile and Fugara contract already support multiple and non-control-system
adapters for the later adapter registry.

## Remote control

The current HTTPS heartbeat provides reporting and pairing only; it does not yet
deliver commands. A future command channel remains capability based:

```json
{
  "commandId": "server-generated-id",
  "adapterId": "opus-two-primary",
  "capability": "stops",
  "action": "set",
  "parameters": {
    "number": 12,
    "active": true
  }
}
```

Organ UI rejects commands whose target adapter did not advertise the
capability, translates accepted commands through that adapter, and returns a
durable acknowledgement keyed by `commandId`. Manufacturer-only actions use a
namespaced capability such as `opus-two.some-feature`.

Command delivery also requires authorization, replay protection, expiry,
idempotency, acknowledgements, and an audit trail. Those belong to the command
transport rather than the monitoring heartbeat.
