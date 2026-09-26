# WolbiRides

Campus-first yellow-yellow ride-hailing for UDS and Tamale, by Wolbi Technologies.

| Part | Path | Stack |
|---|---|---|
| Backend API, realtime, jobs | `backend/` | Django + DRF, Channels (websockets), Celery, PostgreSQL, Redis |
| Rider web app | `frontend/wolbirides_web_passenger/` | React + TypeScript (Vite) |
| Driver web app | `frontend/wolbirides_web_driver/` | React + TypeScript (Vite) |
| Admin dashboard | `frontend/wolbirides_admin/` | React + TypeScript (Vite) |
| Rider mobile app | `mobile/wolbirides_mobile_passenger/` | React Native (Expo SDK 57) |
| Driver mobile app | `mobile/wolbirides_mobile_driver/` | React Native (Expo SDK 57) |

Rider and driver apps have the same features on web and mobile. The only intended differences:
the public "follow my trip" page is web-only; background GPS, push notifications and SOS saved
across restarts are mobile-only.

## Run it locally (Docker, Windows CMD)

```cmd
copy backend\.env.example backend\.env
set COMPOSE_FILE=docker-compose.yml;docker-compose.dev.yml
docker compose up --build
```

| App | URL |
|---|---|
| Rider web | http://localhost:5174 |
| Driver web | http://localhost:5175 |
| Admin | http://localhost:5176 |
| API | http://localhost:8001/api |
| Django admin (local only) | http://localhost:8001/admin/ |

`docker-compose.dev.yml` mounts the backend code so Django reloads on save. Sign-up and
password-reset codes print in `docker compose logs -f backend` until email is configured.
Create an admin with `docker compose exec backend python manage.py createsuperuser`.

Mobile apps run on your machine, not in Docker:

```cmd
cd mobile\wolbirides_mobile_passenger && npm install && npx expo start
cd mobile\wolbirides_mobile_driver && npm install && npx expo start --port 8082
```

Set `extra.apiBaseUrl` / `extra.wsBaseUrl` in each `app.json` to your computer's LAN address.
Push notifications, background GPS and secure token storage need a development build
(`eas build --profile development --platform android`), not Expo Go.

## Checks

```cmd
docker compose exec backend python manage.py test
cd frontend\wolbirides_web_passenger && npm run build && npx oxlint src
cd mobile\wolbirides_mobile_passenger && npx tsc --noEmit && npx oxlint src App.tsx index.ts
```

## Production

Required backend settings (see `backend/.env.example`):

- `DJANGO_DEBUG=False`, `DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS`, `DJANGO_CSRF_TRUSTED_ORIGINS`
- `DJANGO_ADMIN_PATH`: a private path for Django admin (the app won't start without it, and refuses `admin`)
- `DATABASE_URL`, `REDIS_URL`, SMTP settings, `AFRICASTALKING_*`, `CLOUDINARY_URL`,
  `ANTHROPIC_API_KEY`, and the `MOMO_*` keys for MTN MoMo

With `DJANGO_DEBUG=False` the backend redirects to HTTPS, sends HSTS (30 days to start), and
uses secure cookies. TLS is expected to end at your host or load balancer; the web apps' nginx
passes the original protocol through. Run exactly one Celery beat process.

## Security notes

- Sign-in: email + password; refresh tokens rotate and old ones are revoked; a password reset
  signs out every other device. Mobile keeps tokens in the phone's secure storage.
- Rate limits on actions that send SMS, cost money or guess codes. SOS is never rate-limited;
  repeat presses merge into the open alert.
- Web apps send a strict Content-Security-Policy and related headers (see each `nginx.conf`).
