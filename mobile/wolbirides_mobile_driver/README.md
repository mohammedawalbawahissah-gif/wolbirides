# WolbiRides Driver Mobile App (Expo)

React Native + Expo — the driver app, and the fourth sibling in the
WolbiRides client family. Same screens and API contract as
`wolbirides_web_driver`, with one genuinely different piece: **this app
can track location in the background**, which the web driver app
explicitly cannot.

## Screens

- **Sign In / Sign Up** — phone + OTP.
- **Apply** — shown automatically to any driver-role account with no `Driver` record yet.
- **Pending** — shown while `verification_status` is `pending`/`rejected` (WR-07.2 gate).
- **Drive (Home)** — online/offline toggle, live connection + background-tracking status, incoming ride-offer modal with an 18s countdown matching the backend.
- **Active trip** — Google Maps deep link for navigation, start/complete/cancel, live status via websocket.
- **Trips** — history of accepted rides.
- **Earnings** — gross fare collected today/all-time.
- **Profile** — licence/vehicle summary, logout.

`components/DriverGate.tsx` handles the Apply → Pending → Main routing
automatically based on the driver's actual backend state, same pattern
as the web driver app's `DriverGate`.

## Setup

```bash
npm install
npx expo start
```

Update `app.json`'s `expo.extra` block with your backend's reachable
address before testing on a real device or emulator (see the passenger
app's README for the Android-emulator-vs-physical-device IP note — same
applies here).

## The background location piece — read this before testing

`hooks/useDriverDispatch.ts` tries `expo-location`'s
`startLocationUpdatesAsync` (a background task registered via
`expo-task-manager`) first, and only falls back to foreground-only
`watchPositionAsync` if that's unavailable. Two things matter here:

1. **This does not work in Expo Go.** Expo Go dropped background
   location support starting SDK 51. To actually test background
   tracking, you need a **development build**
   (`npx expo run:android` / `npx expo run:ios`, or an EAS dev-client
   build) — not the Expo Go app from the store. In Expo Go, the hook will
   catch the failure and silently degrade to foreground-only tracking
   (the same limitation the web driver app has), and show a banner
   telling the driver as much.
2. **Permissions are two-stage.** iOS/Android both require requesting
   foreground permission first, then background permission separately —
   a driver has to grant "Always" (not just "While Using") for
   background mode to activate. `app.json` has the required
   `NSLocationAlwaysAndWhenInUseUsageDescription` / Android
   `ACCESS_BACKGROUND_LOCATION` entries already wired in via the
   `expo-location` config plugin.

This is exactly the hard problem the original WolbiRides blueprint
(WR-05) and every PRD iteration since have flagged as needing a real
dev-client build, not Expo Go. This app is the first artifact in the
whole project that actually attempts it — treat a real device test on a
dev-client build as the most important open verification step, more
than any other screen in this app.

## Notable dependency issues from this build (same as the passenger app)

- `@react-native-async-storage/async-storage` uses `getMany`/`setMany`/`removeMany`, not the older `multiGet`/`multiSet`/`multiRemove` naming — see the passenger app's README for detail.
- Expo's CLI dependency-compatibility checker needed `EXPO_OFFLINE=1` to bypass a network call this sandbox couldn't make; shouldn't matter on a normal dev machine with internet access.

## Verified this session

- `npx tsc --noEmit` — zero errors
- `EXPO_OFFLINE=1 npx expo export --platform web` — bundled all 592 modules cleanly through Metro
- **Not verified**: rendering on a device, and — critically — the background location task actually firing while backgrounded. Neither is testable without a real device and a dev-client build, which this environment doesn't have. This is the single most important thing to test before trusting this app for a real pilot.

## What's not built yet

- Sound/vibration alert on incoming offers (same gap as the web driver app — easy to miss a ride request if the phone is in a pocket)
- No document/photo upload on the Apply screen
- No payout/commission deduction in Earnings — gross fare only, labeled as such
- App icons/splash screen are still Expo's defaults
