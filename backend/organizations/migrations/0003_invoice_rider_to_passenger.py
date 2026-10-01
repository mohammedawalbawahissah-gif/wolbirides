from django.db import migrations


def _rename(old, new):
    def run(apps, schema_editor):
        Invoice = apps.get_model("organizations", "Invoice")
        for invoice in Invoice.objects.all():
            changed = False
            for item in invoice.line_items or []:
                if old in item:
                    item[new] = item.pop(old)
                    changed = True
            if changed:
                invoice.save(update_fields=["line_items"])
    return run


class Migration(migrations.Migration):
    """Statements named the person who booked the trip "rider". They are passengers: "rider" is what
    people here call the driver, so the key would read as the wrong person."""

    dependencies = [("organizations", "0002_organization_prepaid_balance_balanceentry_and_more")]

    operations = [migrations.RunPython(_rename("rider", "passenger"), _rename("passenger", "rider"))]
