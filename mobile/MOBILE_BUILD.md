# Building the WolbiRides mobile apps

Background GPS (driver app) and reliable location for SOS don't work in Expo Go.
Both apps now include `expo-dev-client` and an `eas.json`, so you build your own
development app once and then iterate with hot reload as usual.

## One-time setup
```bash
npm install -g eas-cli
eas login                      # your Expo account
cd wolbirides_mobile_driver && eas init   # links the project, writes projectId into app.json
cd ../wolbirides_mobile_passenger && eas init
```

## Point the apps at your backend
Edit `extra.apiBaseUrl` / `extra.wsBaseUrl` in each `app.json`. `localhost` only works in
an emulator on the same machine; on a real phone use your laptop's LAN IP
(e.g. `http://192.168.1.20:8000/api`) or your deployed URL.

## Development build (install once per phone)
```bash
eas build --profile development --platform android   # produces an .apk link
```
Install the APK on a test phone, then run `npx expo start --dev-client` and open it.
Rebuild only when you add or change a native module.

## What to test on a real, cheap Android phone (driver app)
1. Go online, lock the screen for 10 minutes: pings should keep arriving
   (watch the admin live map or backend logs).
2. Battery drain over a 1-hour shift with the app in the background.
3. Switch mobile data off/on: the driver should reappear online without reopening the app.
4. Some Android brands (Tecno, Infinix, itel, Xiaomi) kill background apps aggressively;
   drivers may need to set battery mode to "No restrictions" for WolbiRides Driver.

## Preview / production
`eas build --profile preview --platform android` gives a shareable APK for pilot testers.
`production` builds are for Play Store submission.
