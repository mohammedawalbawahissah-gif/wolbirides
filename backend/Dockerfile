FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends libpq5 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN DJANGO_SECRET_KEY=build-only python manage.py collectstatic --noinput

RUN useradd --create-home app && chown -R app /app
USER app

EXPOSE 8000

# One image, three roles (see docker-compose.yml): the ASGI server below
# (Daphne serves HTTP and websockets), a Celery worker, and Celery beat.
# PORT and BIND_HOST default to the docker-compose values; Railway sets PORT=8000 and BIND_HOST=:: (IPv6, needed
# for its private network). If DJANGO_SUPERUSER_PHONE is set, an admin is created once (it does nothing if the
# account already exists; remove the DJANGO_SUPERUSER_* variables after first sign-in).
CMD ["sh", "-c", "python manage.py migrate --noinput && ([ -z \"$DJANGO_SUPERUSER_PHONE\" ] || python manage.py createsuperuser --noinput || true) && exec daphne -b ${BIND_HOST:-0.0.0.0} -p ${PORT:-8000} wolbirides.asgi:application"]
