import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "wolbirides.settings")

app = Celery("wolbirides")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()
