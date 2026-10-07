# Deploying WolbiRides on your own server (VPS): step by step

> Using Railway instead? Follow `deploy/RAILWAY.md`. This file is for a plain Linux server.

One server runs everything (Docker Compose). Caddy in front gives all three web apps HTTPS.

## 0. Before you touch the server
- A Linux server (Ubuntu 22.04+, 2 vCPU / 4 GB RAM) with Docker and the compose plugin. Firewall: allow 22, 80, 443 only.
- A domain you control. Create three DNS **A records** pointing at the server's public IP:
  `app.<domain>`, `rider.<domain>`, `ops.<domain>`. (DNS can take minutes to hours; Caddy can't get certificates until it works.)
- **Resend:** add and verify your sending domain (Resend > Domains; paste the DNS records they show). Create an API key.
- **Cloudflare R2:** two buckets, `wolbirides-public-media` (connect a custom domain such as `files.<domain>`)
  and `wolbirides-private-media` (NO custom domain, r2.dev access OFF). One API token, Object Read & Write, on those two buckets only.
- **Africa's Talking:** your live app username and API key (not the sandbox).

## 1. Copy the project to the server
Copy the project folder WITHOUT `node_modules`, `venv` or `db.sqlite3`. Do not copy your root `.env` (docker-compose.prod.yml sets the hostnames itself).

## 2. Create the two env files (guided)
    python3 deploy/setup_env.py
It asks for each value, generates the database password, Django secret key and private admin path for you, and writes
`deploy/.env.prod` and `backend/.env` (owner-only permissions, old files backed up). Secrets are typed hidden and never printed.
Back up `deploy/.env.prod` in a password manager.

Which file holds what:
- `deploy/.env.prod`: hostnames, certificate email, database password, Django secret key, admin path.
- `backend/.env`: Resend, R2, SMS, AI keys. (Not the root `.env`: that one is only used for local development.)

## 3. Check, then deploy
    ./deploy/deploy.sh
It runs `deploy/check_env.py` first and stops on any mistake (wrong bucket names, trailing slashes, placeholders, empty keys).
Warnings are worth reading but don't block. The first build takes a few minutes.

## 4. Create the first admin
    docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file deploy/.env.prod exec backend python manage.py createsuperuser
Use your real phone number, name, email and a strong password. It is created with the admin role.

## 5. Smoke test
    ./deploy/smoke_test.sh
Checks all three apps load over HTTPS, redirect from http, send HSTS, and reach the API.

## 6. Manual checks (5 minutes, do all of them)
1. **Ops app** (`https://ops.<domain>`): sign in with the admin you created. Create a service zone.
2. **Rider app**: sign up, apply as a rider, upload a Ghana card photo. You should get the verification SMS and an email code.
3. **Ops app**: open the application, expand it, click the Ghana card: the image opens (this is a 10-minute signed link; a link older than that stops working, by design).
4. **Passenger app**: sign up, request a ride with **cash**. Approve the rider in ops first so there is one to match.
5. Confirm the private bucket is private: copy the Ghana card link, remove everything after the `?`, open it. It must show an access-denied error.

## What won't work yet (by design)
- **Mobile money (MoMo/Hubtel):** needs a licensed provider. Until then those payments stay "pending"; cash works. Never set `MOMO_DEV_AUTO_APPROVE=True` in production: it marks payments as paid without taking any money.
- **Mobile apps:** in each app's `app.json` set `extra.apiBaseUrl` to `https://app.<domain>/api` (passenger) and
  `https://rider.<domain>/api` (rider), and `extra.wsBaseUrl` to the matching `wss://.../ws`, then build with EAS.
  Expo Go can't receive push notifications; use a real build.

## Backups
    docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file deploy/.env.prod exec -T db pg_dump -U wolbirides wolbirides | gzip > backup-$(date +%F).sql.gz
Run daily from cron and copy the file off the server. R2 files are stored by Cloudflare; the database is what you must back up.

## Updating later
Copy the changed files over and run `./deploy/deploy.sh` again. Migrations run on backend start.

## If something fails
    docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file deploy/.env.prod logs --tail=100 backend caddy
- Certificate errors: the DNS A records aren't pointing at this server yet.
- "DisallowedHost" or 400 on everything: `deploy/.env.prod` hostnames don't match the address in the browser.
- Emails rejected: the sending domain isn't verified in Resend.
- Upload fails (502): R2 keys/bucket names, or the token doesn't cover both buckets.
