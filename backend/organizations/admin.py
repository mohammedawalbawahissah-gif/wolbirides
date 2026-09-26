from django.contrib import admin

from organizations import models

for model in (getattr(models, n) for n in dir(models)):
    if isinstance(model, type) and hasattr(model, "_meta") and model.__module__ == models.__name__ and not model._meta.abstract:
        admin.site.register(model)
