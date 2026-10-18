# Boardroom Control Panel (PWA) – v0.1.0 proof of concept

A touch panel web app for the boardroom AV system run by the **Atlona Boardroom AV Controller** Q-SYS plugin (v1.5.0).
This version runs in **demo mode**: it simulates the room so every screen can be tried. It does not talk to the Core yet.

## What it does

| Screen | Matches plugin layer | Notes |
|---|---|---|
| Start | Start | Room name, time, **Start meeting** (plugin `SystemOn`). Shows which displays will turn on and the start-up source. |
| Starting the room | Please Wait | Progress ring from `WarmupProgress`; checklist ticks off as feedback arrives (switcher, displays, source, volume). |
| Sources – Both displays | Routing Combined | One tile per input in use, plus Blank. Tile lights only when *every* enabled display shows it (`RouteAll_n`). |
| Sources – Each display | Routing Individual | A column per display (`DispNRoute_n`, `DispNBlank`). On phones, pick the display first. |
| Volume | Volume | Fader, hold-to-repeat − / +, Mute (`MasterVolumePct`, `MasterMute`). Always visible on wall panels. |
| Displays | Display Control | Power on/off (`DispNPowerOn/Off`, feedback `DispNPowerFb`), display speaker volume and mute, input command. |
| End meeting? | Shutdown Confirm | Confirms, then fires `ConfirmYes`. Cancels itself after 30 s. |

The small screens above each source list show what each display is showing right now. Tap one to route to just that display.

## Layouts

Chosen from the screen width (override in Panel settings):

- **Phone** (< 600 px): header, page, bottom tab bar. Volume is its own tab.
- **Tablet** (600–999 px): side rail navigation. Volume is its own page.
- **Wall / table panel** (≥ 1000 px, e.g. 1280×800): side rail, page, and a volume strip that is always on screen.

Short landscape screens (≤ 520 px tall) get a tighter vertical rhythm.

## Control practices built in

- Buttons show the **confirmed** state from the system, never an assumed one. A dashed outline shows a command waiting for feedback; after 4 s without feedback the panel says so.
- Touch targets are 56 px or more on panels, press states are visible on touch, nothing depends on hover.
- Volume up un-mutes. Dragging the fader sends throttled updates; feedback that arrives mid-drag doesn't make the fader jump.
- The panel goes back to Sources after 5 idle minutes (configurable).
- The screen is kept awake during a meeting where the browser allows it.
- App updates wait until no meeting is running, then install.
- Works offline once loaded (service worker caches the app shell and fonts).

## Panel settings

Press and hold the **room name** for 2 seconds (or Ctrl+, on a keyboard). Settings are stored on that device only:
connection (Demo now; Q-SYS Core fields ready for the next version), room name, start-up wait, idle return, theme, layout.

## Files

```
index.html               app shell
css/app.css              design tokens (Castellini orange/sepia), layouts
js/config.js             room defaults and demo room (input/display names, start-up source and volume)
js/transport-demo.js     simulates the plugin using its control names
js/transport-qsys.js     live connection placeholder + the list of plugin controls it will subscribe to
js/app.js                UI logic
sw.js                    service worker (offline + update handling)
manifest.webmanifest     install metadata
icons/                   app icons (any + maskable)
```

## Hosting

A PWA must be served over **HTTPS** (or `localhost`) to install and work offline. Any static web server on the LAN works.
Opening `index.html` straight from disk runs the app but won't install it.

## Next version: live Q-SYS connection

The UI already reads and writes the plugin's control names through a transport interface
(`connect`, `get`, `set`, `trigger`, `onChange`, `onStatus`), so the live version only replaces the transport:

1. Use Q-SYS Remote WebSocket Control (QRWC, npm `@q-sys/qrwc`) to the Core on port 443.
2. Core Manager → Network → Services: enable WebSocket. If Access Control is on, create an access token.
3. In the design, give the plugin a **Code Name** (default here `BoardroomAV`) and set its Code Access to **External** or **All**.
4. The Core closes idle sockets after 60 s, so the transport keeps the connection alive and reconnects.
5. Things to plan for: the Core's HTTPS certificate must be trusted by the panel devices, and a panel served from a different host than the Core needs that host to be HTTPS as well (browsers block insecure WebSockets from HTTPS pages).
