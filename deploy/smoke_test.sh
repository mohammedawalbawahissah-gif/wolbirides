#!/usr/bin/env bash
# Checks the three apps are reachable over HTTPS and wired to the API.
#   Railway:  PASSENGER_HOST=... DRIVER_HOST=... ADMIN_HOST=... BACKEND_HOST=... DJANGO_ADMIN_PATH=ops-xxxx ./deploy/smoke_test.sh
#   VPS:      ./deploy/smoke_test.sh        (reads deploy/.env.prod)
set -uo pipefail
cd "$(dirname "$0")/.."
if [ -z "${PASSENGER_HOST:-}" ] && [ -f deploy/.env.prod ]; then set -a; . deploy/.env.prod; set +a; fi
for v in PASSENGER_HOST DRIVER_HOST ADMIN_HOST; do
  [ -n "${!v:-}" ] || { echo "Set $v (bare address, no https://). See the comment at the top of this file."; exit 2; }
done
fail=0
ok()   { echo "  PASS  $1"; }
bad()  { echo "  FAIL  $1"; fail=1; }
info() { echo "  INFO  $1"; }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 25 "$@"; }

check_app () {  # name host login-path
  local name=$1 host=$2 login=$3 c
  echo "== $name  https://$host"
  c=$(code "https://$host/");  [ "$c" = 200 ] && ok "page loads (200)" || bad "page returned $c"
  c=$(code -X POST -H 'Content-Type: application/json' -d '{}' "https://$host$login")
  [ "$c" = 400 ] && ok "API reachable through this address (login answered 400, as expected for an empty request)" \
    || bad "API login route returned $c (expected 400). 502/503 = web app can't reach the backend; 400 on every page = hostname not allowed"
  curl -si --max-time 25 -X POST -H 'Content-Type: application/json' -d '{}' "https://$host$login" | grep -qi '^strict-transport-security' \
    && ok "backend is in production mode (HSTS header present)" || bad "no HSTS header on API responses: backend may still be in debug mode"
  c=$(code "http://$host/"); [[ "$c" =~ ^30[1278]$ ]] && ok "http redirects to https ($c)" || info "http returned $c (fine if your host blocks plain http)"
}
check_app "Passenger app" "$PASSENGER_HOST" /api/auth/login
check_app "Rider app"     "$DRIVER_HOST"    /api/drivers/auth/login
check_app "Admin app"     "$ADMIN_HOST"     /api/admin/auth/login

DJ_HOST="${BACKEND_HOST:-$ADMIN_HOST}"
if [ -n "${DJANGO_ADMIN_PATH:-}" ]; then
  echo "== Django admin  https://$DJ_HOST/$DJANGO_ADMIN_PATH/"
  c=$(code -L "https://$DJ_HOST/$DJANGO_ADMIN_PATH/login/"); [ "$c" = 200 ] && ok "Django admin login page loads" || bad "Django admin returned $c"
  c=$(code "https://$DJ_HOST/admin/");                        [ "$c" != 200 ] && ok "/admin/ is not exposed ($c)" || bad "/admin/ answers 200: the admin path is not private"
else
  info "Set DJANGO_ADMIN_PATH (and BACKEND_HOST on Railway) to also check Django admin."
fi
echo
if [ $fail = 0 ]; then echo "All checks passed. Now do the manual checks in the runbook (sign in, upload, email, SMS)."
else echo "Some checks failed. Read the FAIL lines above, then check the service logs."; fi
exit $fail
