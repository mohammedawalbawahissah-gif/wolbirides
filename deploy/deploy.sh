#!/usr/bin/env bash
# Run on the server from the project root: ./deploy/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f deploy/.env.prod ] || { echo "Create deploy/.env.prod from deploy/.env.prod.example first"; exit 1; }
[ -f backend/.env ] || cp backend/.env.example backend/.env
set -a; . deploy/.env.prod; set +a
for v in PASSENGER_HOST DRIVER_HOST ADMIN_HOST ACME_EMAIL POSTGRES_PASSWORD DJANGO_SECRET_KEY DJANGO_ADMIN_PATH; do
  [ -n "${!v:-}" ] || { echo "$v is empty in deploy/.env.prod"; exit 1; }
done
# Services configured in backend/.env (Resend email, Cloudflare R2 uploads, SMS)
for v in RESEND_API_KEY DEFAULT_FROM_EMAIL R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET R2_PUBLIC_BASE_URL; do
  grep -Eq "^${v}=.+" backend/.env || { echo "$v is empty in backend/.env"; exit 1; }
done
grep -Eq "^(CLOUDINARY_URL|EMAIL_HOST)=.+" backend/.env && echo "Note: CLOUDINARY_URL / EMAIL_HOST in backend/.env are no longer used; you can delete them."
C="docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file deploy/.env.prod"
$C up -d --build
$C ps
echo "Create the first admin:  $C exec backend python manage.py createsuperuser"
