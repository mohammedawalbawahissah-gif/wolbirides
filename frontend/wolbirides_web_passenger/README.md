# WolbiRides rider web app

React + TypeScript (Vite).

Book rides and deliveries (shared rides, driver preferences, saved places, campus pickup points, promo codes, vouchers, bundles), follow the trip live with the driver's details, pay by MoMo or cash, SOS, trip sharing, safety check-ins, history with "Ride again", notifications, the assistant, and help & support. Also serves the public "follow my trip" page at `/share/<token>`.

## Run

In Docker it's served at http://localhost:5174 (see the root README). For instant reload while
working on it:

```cmd
npm install
npm run dev -- --port 5174
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
