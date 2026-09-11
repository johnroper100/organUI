# Builder-defined console views

Edit `console-controls.json` in the OrganUI directory. Each entry in `views`
creates a tab in `/console` and a standalone page at `/console/custom/<id>`.
The standalone page contains that view's controls and connection/command status.
No separate HTML file is needed. The supplied installation view preserves the
former Organist page's Nazard (stop 13) and Crescendo B (stop 22) controls.

After editing, refresh a page or choose **Settings → Reload custom views** in
the console. Other open pages retain their configuration until refreshed.
Restart the server once after installing this feature; subsequent JSON edits
need no restart. Invalid JSON or configuration displays an error and disables
custom views without stopping the rest of the console. An empty `views` array
removes all custom tabs. View order in the file determines tab order.

## Multiple views

```json
{
  "version": 1,
  "views": [
    {
      "id": "installation",
      "title": "Installation",
      "description": "Installation-specific stop controls.",
      "groups": [{
        "title": "Stops",
        "controls": [
          {"id": "nazard", "type": "stop", "label": "Swell Nazard 2 2/3'", "number": 13},
          {"id": "crescendo-b", "type": "stop", "label": "Crescendo B", "number": 22}
        ]
      }]
    },
    {
      "id": "organ-settings",
      "title": "Organ settings",
      "groups": [{
        "title": "Settings and commands",
        "controls": [
          {"id": "variable-one", "type": "userVariable", "label": "User setting 1", "number": 1},
          {"id": "cancel", "type": "button", "label": "General cancel", "action": {"type": "udp", "command": {"action": "generalCancel"}}},
          {"id": "refresh", "type": "button", "label": "Refresh console", "action": {"type": "osc", "cmd": "/OPTICS/special2001"}},
          {"id": "neutral", "type": "button", "label": "Neutral transposer", "action": {"type": "api", "path": "/api/udp", "method": "POST", "body": {"action": "transposerNeutral"}}},
          {"id": "memory", "type": "display", "label": "Memory level", "feedback": {"type": "state", "key": "memoryLevel"}},
          {"id": "expression", "type": "range", "label": "Expression channel 0", "min": 0, "max": 1, "step": 0.01, "feedback": {"type": "expression", "number": 0}, "action": {"type": "osc", "mode": "send", "cmd": "/faders/fader0", "value": "$value"}},
          {"id": "choose-level", "type": "select", "label": "Memory preset", "options": [{"label": "Level 1", "value": 1}, {"label": "Level 10", "value": 10}], "feedback": {"type": "state", "key": "memoryLevel"}, "action": {"type": "udp", "command": {"action": "gotoLevel", "number": "$value"}}}
        ]
      }]
    }
  ]
}
```

This creates `/console/custom/installation` and `/console/custom/organ-settings`.
Adapt controller numbers and labels to the installation before using examples.
View IDs use lowercase letters, digits and hyphens and must be unique.
Control IDs use letters, digits, hyphens and underscores and must be unique
within their view. Titles, labels and descriptions render as plain text.

## Control types

| Type | Required fields beyond `id`, `type`, `label` | Behavior |
| --- | --- | --- |
| `stop` | `number` (1–65535) | Toggle a stop with live On/Off feedback |
| `userVariable` | `number` (1–10) | Current value and Down/Up OSC pulses |
| `button` | `action` | Run a command; optional feedback marks it active |
| `select` | `options`, `action` | Send the selected option's typed `value` |
| `range` | `min`, `max`, `step`, `action` | Send a numeric value on change/release |
| `display` | `feedback` | Read-only controller value |

Any control can have `description`. Feedback readouts can use `unit` and
`valueLabels`, e.g. `{"0":"Normal","1":"Alternate"}`. A feedback-bound button
uses `activeValue` (default `1`) to determine highlighting. Missing feedback is
shown as “Awaiting feedback”; last values remain visible while disconnected.
Controls are disabled when the browser loses its server connection.

## Actions

- `osc`: `cmd` uses the existing supported OSC address families. Default `mode`
  is `pulse`: send 1 followed by 0 after 80 ms using the existing console pulse
  transport. `mode: "send"` sends the numeric `value` once through `/api/osc`.
  Use send mode for faders, with values from 0 to 1. OSC pulse status means the
  browser sent the command, not that the controller confirmed the new state.
- `udp`: `command` is an existing OrganUI controller action object, as used by
  `/api/udp` and documented in the README/Advanced controls. The server validates
  actions and acknowledges whether they were sent.
- `api`: `path` is a local `/api/...` endpoint. `method` defaults to `POST`;
  `GET`, `PUT`, `PATCH`, and `DELETE` are also supported. Optional `body` is JSON
  (omitted for GET). HTTP failures appear in the command status; requests time
  out after five seconds and are never retried automatically. Responses are
  command acknowledgements, not a new feedback data source. External API URLs
  and custom headers are not supported.

For selectors and sliders, the exact string `"$value"` anywhere in the action
is replaced by the chosen value, preserving its JSON type. It is not a string
interpolation or JavaScript expression. Select option values must be unique
strings, numbers or booleans. Without feedback, inputs show the last requested
value, not a confirmed controller value.

The configuration is returned to browsers by `GET /api/console-controls`;
do not include credentials or secrets. This feature uses the existing controller
protocol validation rather than adding new OSC address families.

## Feedback bindings

| `feedback.type` | Additional field | Source |
| --- | --- | --- |
| `stop` | `number` (1-based) | Stop active state |
| `userVariable` | `number` (1–10) | User-variable value in the current controller page |
| `expression` | `number` (0-based) | Expression/fader value, 0–1 |
| `special` | `number` | OSC special status |
| `state` | `key` | `memoryLevel`, `localMemoryLevel`, `transposer`, `trackNum`, `trackTime`, `sostActive`, or `userVarPage` |

User variables follow the controller's current user-variable page. Page movement
can be configured as OSC buttons for `/UserDef/inc999` and `/UserDef/dec999`.
The `stop` and `userVariable` controls create their own feedback binding from
their `number`; other controls may choose any listed binding.
