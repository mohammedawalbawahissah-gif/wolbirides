# WolbiRides driver web app

React + TypeScript (Vite).

Apply with documents, go online, receive and accept offers (including shared rides and deliveries), work the active trip (stop order, navigation, pickup and drop-off codes, SOS), confirm cash, rate riders, earnings and weekly payouts, notifications, the assistant, and help & support. The dispatch connection stays live on every page.

## Run

In Docker it's served at http://localhost:5175 (see the root README). For instant reload while
working on it:

```cmd
npm install
npm run dev -- --port 5175
```

`.env` sets `VITE_API_BASE_URL` and `VITE_WS_BASE_URL` for development (see `.env.example`).
Production builds use the same origin (`/api`, `/ws`), proxied by `nginx.conf`, which also sets
the security headers.

## Checks

```cmd
npx tsc -b
npx oxlint src
npm run build
```
