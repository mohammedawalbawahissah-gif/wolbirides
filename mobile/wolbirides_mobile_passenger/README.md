# WolbiRides rider mobile app

React Native with Expo SDK 57.

Same features as the rider web app: booking (rides, deliveries, shared rides, preferences, saved places, pickup points, payment options), live trip with driver card and map, pay after the trip, SOS (saved and retried when offline, even after a restart), trip sharing, safety check-ins, history, notifications (in-app and push), the assistant, and help & support.

## Run

```cmd
npm install
npx expo start
```

Point `extra.apiBaseUrl` and `extra.wsBaseUrl` in `app.json` at your computer's LAN address,
for example `http://192.168.1.20:8001/api` and `ws://192.168.1.20:8001`.

Push notifications, background location and secure token storage need a development build
rather than Expo Go:

```cmd
eas build --profile development --platform android
```

Sign-in tokens are kept in the phone's secure storage (`src/tokenStore.ts`).

## Checks

```cmd
npx tsc --noEmit
npx oxlint src App.tsx index.ts
```
