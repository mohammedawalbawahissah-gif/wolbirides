# WolbiRides Admin Dashboard

React + TypeScript (Vite) ops console for founder-run pilot management —
implements PRD Section 4.3 (Admin MVP) against the `adminapi` endpoints
in the Django backend.

## Pages

- **Overview** — the WR-06.4 KPI set (drivers online, trips today, cancellation rate, open incidents/tickets), computed live from `/api/admin/dashboard/summary`.
- **Drivers** — WR-07.2 verification queue: verify or reject a founding driver's application.
- **Trips** — searchable/filterable trip list for reconciliation.
- **Incidents** — severity-filtered queue (WR-06.3 P0–P3) with a resolve action.
- **Support** — read-only ticket list (assignment UI is a Phase 2 addition).
- **Zones** — read-only fare/pickup-point view (add zones via Django admin for now).

## Setup

```bash
npm install
cp .env.example .env       # point VITE_API_BASE_URL at your backend
npm run dev                # http://localhost:5173
```

Requires the WolbiRides backend running with an admin-role user — see the
backend README's `createsuperuser` step, then set that user's `role` to
`admin` via Django admin or shell (OTP-created accounts default to
`passenger`).

## Auth

Same OTP flow as the passenger/driver apps, but hits
`/api/admin/auth/otp/verify`, which refuses to issue a token unless the
account's `role` is `admin` or `support`. JWT is stored in `localStorage`;
a 401 anywhere bounces back to `/login`.

## Design notes

Built as an operations console, not a marketing surface — the brief here
is "what needs my attention right now," so KPI cards and status badges
lead every screen rather than any hero/decorative treatment. Palette
carries the WolbiRides navy/gold identity from the brand docs (`#16233F`
navy, `#B8860B` gold, used sparingly for active states only).

**Not yet visually QA'd with a screenshot** — no headless browser was
available in the build environment this session. The build compiles
clean and every page's data flow is verified against the live backend,
but a first look in an actual browser is worth doing before treating the
visual polish as final.

## Known gaps

- No zone-creation form (read-only view; use Django admin)
- No live map (WR-05.1 recommends Google Maps Platform — needs an API key decision first)
- Support tickets are read-only — no assign/reply flow yet
- No pagination on Trips/Incidents lists (backend caps at 200 rows)
