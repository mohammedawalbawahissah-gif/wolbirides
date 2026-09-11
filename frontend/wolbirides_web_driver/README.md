# WolbiRides Driver Web App

React + TypeScript (Vite) — the driver-facing web client, sibling to the
passenger web app and the eventual driver Expo app. Same auth flow, same
API layer pattern, same phone-frame layout — built so the Expo port later
is a translation, not a redesign.

## Screens (mirrors PRD Section 4.3 / blueprint WR-07)

- **Login** — phone + OTP.
- **Apply** — licence, vehicle plate, emergency contact. Shown automatically to any driver-role account with no `Driver` record yet.
- **Pending** — shown while `verification_status` is `pending`/`rejected`; the WR-07.2 compliance gate, enforced.
- **Drive (Home)** — online/offline toggle, connection status, and the incoming ride-offer modal with an 18s countdown matching the backend's `DISPATCH_OFFER_TIMEOUT_SECONDS`.
- **Active trip** — Google Maps navigation handoff, start/complete/cancel, live status via websocket.
- **Trips** — history of accepted rides.
- **Earnings** — gross fare collected today/all-time.
- **Profile** — licence/vehicle summary, logout.

`DriverGate` (`components/DriverGate.tsx`) handles the Apply → Pending →
Home routing automatically based on the driver's actual backend state —
there's no separate "onboarding wizard" state to keep in sync by hand.

## Setup

```bash
npm install
cp .env.example .env
npm run dev        # http://localhost:5173
```

To test the full loop locally: create an account, apply as a driver, then
flip `verification_status` to `verified` via Django admin or shell (or
via the admin dashboard's Drivers page, built earlier this project).

## The most important limitation: foreground-only location

`hooks/useDriverDispatch.ts` uses the browser's `navigator.geolocation`
API, which **only reports position while this tab is open and in the
foreground**. There is no background location on the web. This is
explicitly the hard problem PRD Section 8 and the original blueprint
(WR-05) flag as needing a native Expo dev-client build with background
permissions — this web app does not solve that, and isn't meant to.

What it **is** good for: running the pilot with a driver's phone propped
up, browser tab open, screen on. That's a legitimate way to operate
during WR-11's closed beta (20–50 founding drivers) before investing in
the native app's background-tracking setup. Don't treat this as "the
driver app" long-term — treat it as the fastest path to a working pilot
loop while the Expo app is built properly.

## Notable backend dependency this app exposed

Building this screen surfaced two real bugs in the backend's dispatch
path (both fixed, documented in the backend README):

1. `redis-py` version incompatibility with `channels_redis` that silently killed driver websocket connections.
2. The driver's websocket consumer never joined its own personal dispatch group, so ride offers had nowhere to land.

Both were caught by writing a real end-to-end test (actual websocket
client + actual HTTP calls) before building UI on top of the assumption
that dispatch worked. Worth keeping that kind of test in the repo
long-term as a regression guard.

## What's not built yet

- No document/photo upload (Apply form collects text fields only — Cloudinary isn't configured, per the backend's open question)
- No payout/commission deduction in the Earnings view — it's gross fare, not take-home pay (labeled as such in the UI)
- No decline reason capture (declining just cascades to the next driver silently)
- No sound/vibration alert on incoming offers — easy to miss if the tab isn't focused, another reason this is a pilot bridge rather than the long-term driver experience
