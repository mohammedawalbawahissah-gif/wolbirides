# Deploying WolbiRides on Railway

You will end up with **eight things** in one Railway project:

| Name (use exactly this) | What it is | Folder it builds from |
|---|---|---|
| `Postgres` | database (Railway add-on) | none |
| `Redis` | live updates and background jobs (Railway add-on) | none |
| `backend` | the API and websockets | `backend` |
| `worker` | background jobs | `backend` |
| `beat` | scheduled jobs (payouts, reminders). **Exactly one copy, never two.** | `backend` |
| `passenger-web` | passenger website | `frontend/wolbirides_web_passenger` |
| `rider-web` | rider website | `frontend/wolbirides_web_driver` |
| `admin-web` | ops dashboard | `frontend/wolbirides_admin` |

Only `Postgres`, `Redis` and `backend` must be named exactly this: the variables refer to them by name. The three web
services can be called anything (for example `passenger`, `rider`, `admin`); wherever this guide says `passenger-web`, `rider-web` or
`admin-web`, use your own names. Railway's screens change from time to
time; if a label below isn't exactly what you see, look for the closest one.

Railway handles HTTPS, public addresses and the private network between services. You do not need a server or Caddy.

---

## Step 0. Have these ready
- A **GitHub** account. Railway deploys from a GitHub repository.
- Your **Resend** API key, with your sending domain **verified** in Resend (Resend > Domains).
- Your **Cloudflare R2** details: Account ID, an API token (Object Read & Write on both buckets), and the two buckets
  `wolbirides-public-media` (with a public address) and `wolbirides-private-media` (no public address, r2.dev off).
- Your **Africa's Talking** live username and API key.

## Step 1. Put the project on GitHub (private repository)
Your `.gitignore` already keeps `.env` files, `venv` and `node_modules` out. Before the first push, run `git status` and
confirm no `.env` file is listed. Create a **private** repo and push the whole project folder.

## Step 2. Create the Railway project and the two databases
1. Railway > **New Project** > **Deploy PostgreSQL**. Leave its name as `Postgres`.
2. In the same project: **New** > **Database** > **Add Redis**. Leave its name as `Redis`.

## Step 3. Create the six services
For each row in the table above (backend, worker, beat, passenger-web, rider-web, admin-web):
1. **New** > **GitHub Repo** > pick your repo.
2. Open the new service > **Settings**:
   - **Service name**: rename it to exactly the name in the table.
   - **Root Directory**: the folder from the table.
3. For `worker` and `beat` only, in **Settings > Deploy > Custom Start Command**:
   - worker: `celery -A wolbirides worker -l info`
   - beat: `celery -A wolbirides beat -l info --schedule /tmp/celerybeat-schedule`

   Leave `backend` and the three web services on their default start command.
4. Make sure `beat` and `backend` each have **1 replica**.

The first builds may fail or crash because the variables aren't set yet. That is expected.

## Step 4. Get the public addresses
Open each of these four services > **Settings > Networking** > **Generate Domain**:
`passenger-web`, `rider-web`, `admin-web` and `backend` (the backend one is only for Django's own admin page; skip it if
you don't want that page). You get addresses like `passenger-web-production-1a2b.up.railway.app`.
If Railway asks which **port** the service listens on: `backend` = **8000**, each of the three web services = **80**.
Write the four addresses down. Do **not** generate domains for `worker`, `beat` or the databases.

## Step 5. Build your variables (guided)
On your computer, in the project folder:

    python3 deploy/railway_env.py

It asks for the four addresses, your first admin's phone, email and password, and your Resend, R2, Africa's Talking and
(optional) Anthropic details. It generates the Django secret key and the private admin path itself. It writes two files and
prints no secrets.

Then paste:
1. Open `deploy/.env.railway.backend`, copy everything. In **backend**, **worker** and **beat**: **Variables** >
   **Raw Editor** > paste > **Update Variables** (do not deploy yet if Railway asks, just save).
2. Open `deploy/.env.railway.web`, copy everything. Paste the same way into **passenger-web**, **rider-web** and **admin-web**.
3. Delete both `.env.railway.*` files from your computer afterwards. They contain your keys.

## Step 6. Deploy and watch
Deploy `backend` first. Open its **Deployments > View logs**. You should see the database migrations run
("Applying ... OK"), "Superuser created successfully", and the server starting. Then deploy `worker`, `beat`, and the three
web services. Everything should end up green.

**After the first successful sign-in as admin (step 7), delete these three variables from `backend`, `worker` and `beat`:**
`DJANGO_SUPERUSER_PHONE`, `DJANGO_SUPERUSER_EMAIL`, `DJANGO_SUPERUSER_PASSWORD`. They are only needed to create the first admin.

## Step 7. Check it works
Run the automatic check from your computer (replace the addresses and the admin path; the admin path is the
`DJANGO_ADMIN_PATH` line in `.env.railway.backend`, or in the backend's variables on Railway):

    PASSENGER_HOST=passenger-web-production-1a2b.up.railway.app \
    DRIVER_HOST=rider-web-production-3c4d.up.railway.app \
    ADMIN_HOST=admin-web-production-5e6f.up.railway.app \
    BACKEND_HOST=backend-production-7a8b.up.railway.app \
    DJANGO_ADMIN_PATH=ops-xxxxxxxxxx \
    ./deploy/smoke_test.sh

Then do these by hand (about five minutes):
1. **Ops app**: sign in with the admin email and password you gave in step 5. Create a service zone.
2. **Rider app**: sign up, apply as a rider, upload a Ghana card photo. You should receive the SMS code and an email code.
3. **Ops app**: open that application, expand it, click the Ghana card. The image opens. (It is a 10-minute link by design.)
4. Copy that Ghana card link, delete everything from the `?` onward, open it: it must show **access denied**.
5. **Passenger app**: sign up and request a ride paid in **cash** (approve a rider in ops first so one can be matched).

## Step 8. Your own domain later (optional)
In each web service > **Settings > Networking** > **Custom Domain**, add for example `app.yourdomain.com`. Railway shows a
CNAME record to add at your DNS provider (Cloudflare). Set that record to **DNS only** (grey cloud), not proxied, at first.
When all three work, run `python3 deploy/railway_env.py --hosts-only`, enter the new addresses, and it prints four lines
(no secrets). In `backend`, `worker` and `beat` > Variables, replace just those four variables with the printed values,
then redeploy those three. Your secret key, admin path and everyone's sign-ins are untouched. The old `*.up.railway.app`
addresses can stay as they are.

## Notifications by email and SMS, and place search
- **Email and SMS:** nothing to set up beyond your Resend and Africa's Talking variables. The `worker` service sends them,
  so it must be running and must have the same variables as `backend`. SMS costs per message, so only these go by text:
  rider assigned, rider close by, trip cancelled, "Are you OK?" check, courier assigned, new delivery request (to riders),
  payouts, rider verification results and SOS (to staff). Account notices (support, bundles, receipts) go by email.
  Set `NOTIFY_CHANNELS_ENABLED=False` on `backend`, `worker` and `beat` to switch both off.
- **Place search:** works with no setup (it asks OpenStreetMap). For good results add the places people actually say
  (hostels, halls, gates, markets): edit `deploy/places_template.csv`, then run
  `python manage.py import_places deploy/places_template.csv --dry-run` and again without `--dry-run`, or add them
  one by one in Django admin > Places. Later you can set `GEOCODER_PROVIDER=geoapify` (or `locationiq`) and `GEOCODER_API_KEY`.

- **The map picture** is OpenFreeMap (free for commercial use, no key, no variable to set). If it can't load, or a phone has no
  WebGL, the apps fall back to plain OpenStreetMap tiles by themselves. To use another provider's style later, set
  `VITE_MAP_STYLE_URL` as a build variable on the web services.

## What won't work yet (by design)
- **Mobile money (MoMo/Hubtel)** needs a licensed provider. Until then those payments stay pending; cash works.
  Never set the `*_DEV_AUTO_APPROVE` variables to True in production: that marks payments paid without taking any money.
- **Phone apps** are separate: in each app's `app.json`, set `extra.apiBaseUrl` to `https://<passenger-web address>/api`
  (rider app: the rider address) and `extra.wsBaseUrl` to the matching `wss://.../ws`, then build with EAS.

## If something is wrong
| What you see | Likely cause |
|---|---|
| A web app loads but the API check says 502/503 | `BACKEND_ORIGIN` or `NGINX_RESOLVER` missing on that web service, or `backend` isn't running / isn't named exactly `backend`, or `PORT=8000` missing on `backend` |
| Everything returns 400 "DisallowedHost" | An address in your browser isn't in `DJANGO_ALLOWED_HOSTS` (re-run the generator and re-paste) |
| Sign-in works on one app but "network error" on another | That web service is missing the web variables |
| Emails never arrive | The sending domain isn't verified in Resend, or `DEFAULT_FROM_EMAIL` isn't on it |
| Photo/document upload fails | R2 keys, bucket names, or the token doesn't cover both buckets |
| Backend crashes on start with "Address family not supported" | Set `BIND_HOST` to `0.0.0.0` on `backend` |
| Jobs run twice (double payouts/reminders) | More than one `beat` replica: reduce to 1 |

Railway bills by usage across all eight things above: check their pricing page and set a spending limit in the project
settings before you launch.
