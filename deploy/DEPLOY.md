# Deploying WolbiRides (single server, Docker Compose + Caddy)

## Before you start
- A Linux server (Ubuntu 22.04+, 2 vCPU / 4 GB RAM is plenty for a pilot) with Docker + the compose plugin.
- Three DNS A records pointing at the server's IP, e.g. app.<domain>, rider.<domain>, ops.<domain>.
- Firewall: allow 22, 80, 443 only.

## Steps
1. Copy the project to the server (git clone or scp), WITHOUT node_modules.
2. `cp deploy/.env.prod.example deploy/.env.prod` and fill it in.
   - Secret key: `python3 -c "import secrets;print(secrets.token_urlsafe(64))"`
   - Postgres password: any long random string.
   - Django admin path: something private, not "admin".
3. In `backend/.env` set (see `backend/.env.example`):
   - **Resend:** `RESEND_API_KEY`, and `DEFAULT_FROM_EMAIL` on a domain you've verified in Resend
     (add Resend's DNS records for the domain first, or sends are rejected).
   - **Cloudflare R2:** `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`,
     `R2_PUBLIC_BASE_URL`. Create the bucket, give it a public custom domain (e.g. files.<domain>),
     and make the API token Object Read & Write on that bucket only.
   - `AFRICASTALKING_*` for SMS, `ANTHROPIC_API_KEY` for the assistant.
   - Delete the old `CLOUDINARY_URL` and `EMAIL_HOST*` lines; they are no longer read.
   MoMo/Hubtel stay blank until you have a licensed provider; with the dev auto-approve switched off
   (the prod overlay does this), payments will NOT silently succeed.
4. `./deploy/deploy.sh`
5. Create the first admin: `docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file deploy/.env.prod exec backend python manage.py createsuperuser`
   (use role admin; set it in the shell if the command doesn't ask for it).
6. Open https://<ops host>, sign in, create a zone.

## Mobile apps
In each app's `app.json`, set `extra.apiBaseUrl` to `https://<passenger host>/api` and
`extra.wsBaseUrl` to `wss://<passenger host>/ws`, then build with EAS (`eas build`).
Expo Go cannot receive remote push notifications; use a real build for that.

## Backups
`docker compose ... exec db pg_dump -U wolbirides wolbirides | gzip > backup-$(date +%F).sql.gz` (run daily from cron and copy off the server).

## Updating
Copy the new files over, run `./deploy/deploy.sh` again. Migrations run on backend start.
