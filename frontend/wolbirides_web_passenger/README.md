# WolbiRides Passenger Web App

React + TypeScript (Vite) — the passenger-facing web client, built to be
the direct sibling of the eventual passenger Expo app (same screens, same
API calls, same state shape) so porting to React Native later is close to
a 1:1 translation rather than a redesign.

## Screens (mirrors PRD Section 4.2)

- **Login** — phone + OTP, same flow as every other WolbiRides client.
- **Home ("Where to?")** — pick pickup/destination on a map, see a live fare estimate, request a ride.
- **Trip status** — live status via websocket (`/ws/trip/:id/`), cancel while unmatched, star rating after completion.
- **History** — past rides, tap through to re-view any trip.
- **Profile** — name, logout.

## Setup

```bash
npm install
cp .env.example .env
npm run dev        # http://localhost:5173
```

## Notable decisions

**Leaflet + OpenStreetMap instead of Google Maps Platform.** The blueprint
(WR-05.1) names Google Maps as the default, but that needs an API key
decision that hasn't been made yet (PRD Section 12 open question). OSM
tiles via Leaflet need no key at all, so the pickup/destination picker
works immediately. Swapping to Google Maps later is a component-level
change (`components/PinPicker.tsx`), not an architectural one.

**Phone-frame layout.** The app renders as a constrained ~430px column
with a bottom tab bar even on desktop browsers — deliberately, since this
is meant to look and behave like the mobile app it's a sibling of, not a
responsive website that happens to work on phones.

**Client-side distance calculation.** `Home.tsx` computes straight-line
distance (haversine) between the two pins and sends it as `distance_km` on
the trip-request payload — the backend's fare quote is linear off that
number (`trips/services.py::quote_fare`). This is a placeholder until
real routing distance (not straight-line) is worth the added complexity.

## What's not built yet

- No driver-location marker on the trip-status map (would need the admin/driver zone websocket feed piped into this app — currently only status text updates)
- No push notifications (web push or otherwise) — relies on the websocket connection staying open
- No offline queueing (PRD Section 8 flags this as a requirement; implemented for the Expo apps' background-sync pattern, not yet ported here)
- No payment UI — MoMo/cash selection happens implicitly (cash by default); wiring the MoMo initiate call into the trip-request flow is next
