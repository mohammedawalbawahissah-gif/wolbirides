from django.db import migrations, models


def backfill(apps, schema_editor):
    Incident = apps.get_model("incidents", "Incident")
    Incident.objects.filter(is_sos=True).update(trigger_source="sos_button")
    Incident.objects.filter(is_sos=False, reported_by__isnull=True).update(trigger_source="overdue_checkin")


class Migration(migrations.Migration):
    dependencies = [("incidents", "0002_incident_is_sos_incident_location_lat_and_more")]

    operations = [
        migrations.AddField("incident", "trigger_source", models.CharField(
            max_length=20, default="manual_report",
            choices=[("sos_button", "SOS button"), ("post_trip_checkin", "Post-trip check-in"),
                     ("overdue_checkin", "Unanswered in-trip check-in"), ("manual_report", "Manual report")])),
        migrations.RunPython(backfill, migrations.RunPython.noop),
        migrations.RemoveField("incident", "is_sos"),
    ]
