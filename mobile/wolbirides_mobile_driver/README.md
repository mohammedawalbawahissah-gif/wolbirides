# WolbiRides driver mobile app

React Native with Expo SDK 57.

Same features as the driver web app, plus background location while online. The server tells the app when to track precisely (heading to or carrying a rider) and when to save battery (waiting for work).

## Run

```cmd
npm install
npx expo start --port 8082
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
