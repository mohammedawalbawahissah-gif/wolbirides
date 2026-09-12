# WolbiRides Passenger Mobile App (Expo)

React Native + Expo — the passenger app, and the third sibling in the
WolbiRides client family (web passenger app, web driver app, and this).
Same screens, same API contract, same auth flow as
`wolbirides_web_passenger` — this is close to a line-for-line port of
that app's logic into React Native components.

## Screens

- **Sign In / Sign Up** — phone + OTP, matching every other WolbiRides client.
- **Ride (Home)** — tap-to-pin pickup/destination, live fare estimate, request a ride.
- **Trip status** — presented as a modal over the tab bar; live updates via websocket, cancel while unmatched, star rating after completion.
- **History** — past rides, tap through to re-view any trip.
- **Profile** — name, logout.

## Setup

```bash
npm install
npx expo start
```

Scan the QR code with Expo Go (iOS/Android) for a fast start, or run
`npx expo start --web` to preview in a browser. Update the API URLs in
`app.json`'s `expo.extra` block before running against anything other
than `localhost` — an emulator/simulator can't reach your machine's
`localhost` directly (Android emulators use `10.0.2.2`; a physical
device needs your machine's LAN IP).

```json
"extra": {
  "apiBaseUrl": "http://YOUR_LAN_IP:8000/api",
  "wsBaseUrl": "ws://YOUR_LAN_IP:8000"
}
```

## Notable decisions

**WebView + Leaflet instead of react-native-maps.** Exactly the same
reasoning as the web app's `PinPicker`: `react-native-maps`' Google
provider needs an API key that hasn't been decided yet (PRD Section 12),
and its default Android behavior also needs Google Maps. Wrapping the
same Leaflet/OpenStreetMap page used conceptually on web inside a
`WebView` (`components/PinPickerMap.tsx`) keeps pickup/destination
selection working with zero API keys on both platforms. It does mean the
map needs network access to load Leaflet's JS/CSS from a CDN on first
render — fine for a live pilot, worth caching locally if this ever needs
to work fully offline.

**AsyncStorage instead of localStorage.** Direct swap, same token/user
persistence pattern as the web apps' `client.ts`.

**No background location in this app.** This is the *passenger* app —
background location is the driver app's problem, not this one's. The
passenger app only needs foreground location for map centering (not even
wired up yet — the map centers on the zone's midpoint, not the user).

## Dependency notes from this build

- `@react-native-async-storage/async-storage` resolved to a newer major
  version (3.x) than most existing tutorials assume — its batch methods
  are `getMany`/`setMany`/`removeMany`, not the older
  `multiGet`/`multiSet`/`multiRemove` naming. The code here uses the
  current names; if you see those errors after a fresh `npm install`,
  that's why.
- `react-native-webview` needed bumping to `16.0.0` — the version Expo's
  installer would have picked (`14.0.1`) doesn't have working TypeScript
  definitions under React 19's JSX types and fails to compile.
- Expo's own CLI dependency-compatibility checker (`expo install`,
  `expo export`'s pre-flight doctor) calls an Expo API endpoint that
  wasn't reachable from this sandbox's network allowlist. Plain `npm
  install` was used instead, and `EXPO_OFFLINE=1` unblocks `expo export`
  for local bundle validation. This shouldn't affect a normal dev
  machine with full internet access — flagging it here only because it's
  atypical for an Expo project.

## Verified this session

- `npx tsc --noEmit` — zero errors across the full app
- `EXPO_OFFLINE=1 npx expo export --platform web` — successfully bundled
  all 629 modules with Metro, confirming every import resolves and the
  dependency graph is sound (not just that individual files typecheck in
  isolation)
- **Not verified**: actual rendering on a device or simulator. No
  physical device, iOS simulator, or Android emulator was available in
  this environment. The bundle compiles and resolves correctly, but a
  real run-through on your phone via Expo Go is the next real test.

## What's not built yet

- Push notifications for trip status changes (relies on the websocket connection staying open while the app is foregrounded)
- Offline request queueing (PRD Section 8 requirement, not yet ported from the driver app's equivalent gap)
- MoMo payment UI — cash is the implicit default, same as the web app
- App icons/splash screen are still Expo's defaults — swap `./assets/icon.png` etc. before any real distribution
