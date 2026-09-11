# WolbiRides Backend (MVP)

Django/DRF + Django Channels backend implementing the API surface and data
model from the WolbiRides MVP PRD (Section 5–8), derived from the WR-01→WR-12
Master Startup Blueprint.

Stack: **Django 5.2 LTS** (standardized to match NeoMatCare) + DRF + Channels
+ Redis + Celery + PostgreSQL (SQLite for local dev).

## Apps

| App | Responsibility |
|---|---|
| `core` | Shared base model (UUID pk + timestamps), immutable `AuditLog` |
| `accounts` | Phone/OTP auth (`User`), `StudentProfile` |
| `zones` | `ServiceZone`, `PickupPoint` |
| `drivers` | `Driver`, `Vehicle`, verification gate (WR-07.2) |
| `trips` | `Trip` lifecycle, `TripEvent` audit trail, `FareQuote`, `Rating`, Channels consumers, Redis-backed matching, Celery dispatch-timeout task |
| `payments` | `Payment`, `Payout`, MoMo integration seam (provider TBD, see Open Questions) |
| `incidents` | `Incident` with WR-06.3 severity levels + auto-suspend on P0/P1 |
| `support` | `SupportTicket` |

## Local setup

```bash
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env              # then fill in real values
python manage.py migrate
python manage.py createsuperuser --phone +233200000000

# You need Redis running locally for Channels + Celery + matching to work:
redis-server &

# Runs Django + Channels together (Daphne, via ASGI_APPLICATION)
python manage.py runserver 0.0.0.0:8000

# In a second terminal, for the dispatch-offer timeout cascade:
celery -A wolbirides worker -l info
```

Admin dashboard (Django admin, for founder-run pilot ops per WR-06.1):
`http://localhost:8000/admin/`

## Environment variables

See `.env.example`. Key ones:

- `REDIS_URL` — required for Channels, matching, and Celery. Defaults to `redis://localhost:6379`.
- `AFRICASTALKING_USERNAME` / `AFRICASTALKING_API_KEY` — if unset, OTP codes are printed to the console log instead of sent (dev fallback, see `accounts/services.py`).
- `MOMO_API_KEY` / `MOMO_API_SECRET` — unset until a licensed provider is confirmed (WR-10.3 / PRD Section 12 open question); cash payments work without these.
- `CORS_ALLOWED_ORIGINS` — comma-separated list, for the separate React admin dashboard.
- `DATABASE_URL` — point at Postgres in staging/production; SQLite is used automatically if unset (dev only).

## API surface

Full endpoint list is in the PRD (Section 7). Quick reference:

```
POST /api/auth/otp/request
POST /api/auth/otp/verify          -> {access, refresh, user}
GET  /api/passengers/me
PATCH /api/passengers/me

POST /api/drivers/apply
GET  /api/drivers/me
PATCH /api/drivers/me/status       -> {is_online, zone_id}

POST /api/trips                    -> creates trip + starts dispatch cascade
GET  /api/trips/:id
POST /api/trips/:id/cancel
POST /api/trips/:id/complete
POST /api/trips/:id/rating

POST /api/payments/momo/initiate
POST /api/payments/momo/webhook

POST /api/incidents
PATCH /api/incidents/:id           (admin only)

POST /api/support/tickets

ws /ws/driver/location/?token=<jwt>
ws /ws/trip/<trip_id>/?token=<jwt>
ws /ws/admin/zone/<zone_id>/live/?token=<jwt>
```

Auth for both REST and websocket connections uses the same JWT — for
websockets, pass it as `?token=<access_token>` since most mobile websocket
clients can't set an Authorization header on the handshake.

## How matching actually works (PRD Section 6)

1. Passenger `POST /api/trips` → `Trip` created (`requested`), `FareQuote` computed from the zone's `base_fare` + `per_km_rate`.
2. `start_dispatch_cascade()` looks up online, verified drivers in the zone from Redis (`trips/matching.py`), ranks by straight-line distance, and offers to the nearest one over their websocket.
3. A Celery task (`trips/tasks.py::check_dispatch_offer_timeout`) fires after `DISPATCH_OFFER_TIMEOUT_SECONDS` (18s) — if the trip is still `matching`, it cascades to the next candidate.
4. Driver accept → `Trip.status = matched`, both parties get pushed updates over `/ws/trip/<id>/`.

Driver location itself is **not** written to Postgres on every ping — it
lives in Redis with a short TTL (`DRIVER_LOCATION_TTL_SECONDS`), per PRD
Section 8's non-functional requirements. Only trip-relevant state
transitions hit the database, each producing an immutable `TripEvent` row.

## What's deliberately not built yet

Per PRD Section 9 (Out of Scope for MVP) and Section 12 (Open Questions):

- Real MoMo provider call (seam exists in `payments/services.py`, no provider wired in — needs a Bank of Ghana-licensed partner per WR-10.3)
- Scheduled rides, referrals, institutional accounts, delivery/logistics
- Automated tests (none written yet — recommend starting with `trips/services.py`'s state machine, since it's the highest-risk logic)
- Production settings split (`settings/base.py` + `settings/production.py`) — currently one `settings.py` for MVP speed
- Rate limiting on OTP/ride-request endpoints (flagged in PRD Section 8, not yet implemented)

## Verified working (smoke-tested this session)

- OTP request → verify → JWT issuance, with console fallback when Africa's Talking isn't configured
- Authenticated `/me` endpoint
- Full trip request → fare quote → Redis dispatch cascade (correctly returns `no_drivers_found` with no drivers online)
- Support ticket creation
- Incident creation, including the P0/P1 auto-suspend path
- `makemigrations` / `migrate` / `check` all clean on Django 5.2.17 across all 8 apps
