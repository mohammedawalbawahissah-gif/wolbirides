# WolbiRides admin dashboard

React + TypeScript (Vite).

Overview, drivers and verification, trips, zones (with SOS security contacts), incidents (live SOS map), support, payouts, organizations and vouchers, bundles, partners, sponsored placements, dispatch fairness, and trust indicators. Only `admin` accounts can use it.

## Run

In Docker it's served at http://localhost:5176 (see the root README). For instant reload while
working on it:

```cmd
npm install
npm run dev -- --port 5176
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
