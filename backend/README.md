# WolbiRides backend

Django + Django REST Framework API, Django Channels websockets (Daphne), Celery jobs.

| App | What it covers |
|---|---|
| `core` | Notifications (+ Expo push), uploads, AI assistant, shared throttles |
| `accounts` | Users (email + password), password reset, saved places, recurring rides |
| `zones` | Service zones, pickup points, fares, SOS security contact |
| `drivers` | Applications, verification, online status, capabilities |
| `trips` | Requests, dispatch (fair queue, preferences), pooling, deliveries, ratings, realtime |
| `payments` | MTN MoMo collections and payouts, cash confirmation, weekly driver payouts |
| `safety` | Trip sharing, in-trip safety checks |
| `incidents` | SOS, post-trip check-ins, incident handling |
| `support` | Support tickets |
| `organizations` | Organization billing, vouchers, prepaid balances, invoices |
| `bundles` | Prepaid ride bundles |
| `partners` | Partner venues, promo codes, sponsored placements |
| `adminapi` | Admin dashboard endpoints |

Endpoints are defined in each app's `urls.py` (mounted under `/api/` in `wolbirides/urls.py`);
websocket routes are in `trips/routing.py`.

## Run

Use Docker from the project root (see the root README). Without Docker:

```cmd
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 0.0.0.0:8001
celery -A wolbirides worker -l info --pool=solo
celery -A wolbirides beat -l info
```

Settings are read from environment variables (Docker loads `backend/.env`); see `.env.example`.
Redis is required for websockets, dispatch and Celery.

With keys left blank: SMS and email codes print to the console, MoMo payments auto-approve in
development, and uploads and the assistant report that they aren't configured.

## Tests

```cmd
python manage.py test
```

No Redis or Celery is needed for the test suite.
