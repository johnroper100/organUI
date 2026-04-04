# Organ Remote Watch App

This folder contains a small watchOS SwiftUI app that sends the same `cmd/state`
pairs as the existing tuner page:

- `Back` sends `/OPTICS/special2014`
- `Next` sends `/OPTICS/special2015`

The watch app talks to the Node server over HTTP by posting JSON to
`/api/osc`. That endpoint was added to the existing `server.js` so the web UI
and watch UI both drive the same OSC bridge. The watch now discovers that
server automatically over Bonjour, so it does not depend on a fixed IP address.

## Build Notes

1. Open [OrganRemoteWatch.xcodeproj](./OrganRemoteWatch.xcodeproj) in Xcode on
   a Mac.
2. Set your Apple Developer team and replace the placeholder bundle ID.
3. Build and run on an Apple Watch or the watchOS simulator.
4. The first launch will ask for local network access so the watch can browse
   for `_organremote._tcp` on your LAN.

The watch target now explicitly opts into Always On display support. On Apple
Watch models that support Always On, the app remains visible in the dimmed
state while it stays frontmost. The exact duration still follows the user’s
watch settings under `Settings > General > Wake Screen > Return to Clock`, and
Always On can also be disabled globally or per app by the user.

If Bonjour is unavailable in your environment, you can still set an optional
manual fallback in `RemoteConfiguration.serverInput`. It accepts the same URL
you would type into Safari, for example:

- `http://192.168.50.137/tuner`
- `http://192.168.50.137:3000/tuner`

In the normal connected state the watch shows the resolved IP above the
discovered service name. If a connection fails, the watch shows a diagnostic
target only in the error state, and direct host/IP details are otherwise only
surfaced when the app is using a manual fallback URL.

## If Xcode Regenerates The Project

This repository was edited from a non-macOS environment, so the source files are
the important part. If you prefer, you can also create a new watchOS
`App > Watch-only App` project in Xcode and copy in the files from the
`OrganRemoteWatch` folder.
