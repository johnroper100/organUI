# Organ Remote Watch App

This folder contains a small watchOS SwiftUI app that sends the same `cmd/state`
pairs as the existing tuner page:

- `Back` sends `/OPTICS/special2014`
- `Next` sends `/OPTICS/special2015`

The watch app talks to the Node server over HTTP by posting JSON to
`/api/osc`. That endpoint was added to the existing `server.js` so the web UI
and watch UI both drive the same OSC bridge.

## Build Notes

1. Open [OrganRemoteWatch.xcodeproj](./OrganRemoteWatch.xcodeproj) in Xcode on
   a Mac.
2. Set your Apple Developer team and replace the placeholder bundle ID.
3. If your server URL is different, update `RemoteConfiguration.serverInput` in
   `OrganRemoteWatch/RemoteConfiguration.swift`.
4. Build and run on an Apple Watch or the watchOS simulator.

`serverInput` accepts the same URL you would type into Safari, for example:

- `http://192.168.50.137/tuner`
- `http://192.168.50.137:3000/tuner`

The app normalizes that value down to the host origin and then posts commands
to `/api/osc`.

## If Xcode Regenerates The Project

This repository was edited from a non-macOS environment, so the source files are
the important part. If you prefer, you can also create a new watchOS
`App > Watch-only App` project in Xcode and copy in the files from the
`OrganRemoteWatch` folder.
