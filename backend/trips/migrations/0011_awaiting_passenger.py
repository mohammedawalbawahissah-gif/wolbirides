from django.db import migrations, models


def _rename(old, new):
    def run(apps, schema_editor):
        apps.get_model("trips", "Trip").objects.filter(preference_status=old).update(preference_status=new)
    return run


class Migration(migrations.Migration):
    """A trip waiting on the passenger's decision was recorded as "awaiting_rider". "Rider" means the person
    carrying the job, so the value is renamed on existing rows too."""

    dependencies = [
        ("trips", "0010_alter_trip_preference_status"),
    ]

    operations = [
        # Widen first: the new value doesn't fit in the old column on Postgres.
        migrations.AlterField(
            model_name="trip",
            name="preference_status",
            field=models.CharField(
                blank=True, default="", max_length=20,
                choices=[("", "None"), ("awaiting_passenger", "Waiting for passenger's decision"),
                         ("keep_waiting", "Passenger chose to keep waiting"), ("relaxed", "Passenger accepted any driver")],
            ),
        ),
        migrations.RunPython(_rename("awaiting_rider", "awaiting_passenger"), _rename("awaiting_passenger", "awaiting_rider")),
    ]
