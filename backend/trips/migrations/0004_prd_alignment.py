"""
Align trips with the Growth PRD (WR-17/19/21/23) without losing data:
renames are real renames, and delivery fields move into DeliveryDetail.
"""
import secrets

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def move_delivery_fields(apps, schema_editor):
    Trip = apps.get_model("trips", "Trip")
    DeliveryDetail = apps.get_model("trips", "DeliveryDetail")
    for trip in Trip.objects.filter(trip_type="delivery"):
        DeliveryDetail.objects.create(
            trip=trip,
            recipient_name=trip.recipient_name,
            recipient_phone=trip.recipient_phone,
            package_description=trip.package_description,
            pickup_code=f"{secrets.randbelow(10000):04d}",
            dropoff_code=trip.delivery_code or f"{secrets.randbelow(10000):04d}",
        )


class Migration(migrations.Migration):
    dependencies = [
        ("trips", "0003_trip_is_pool_trip_seats_ridepool_trip_pool"),
        ("organizations", "0002_organization_prepaid_balance_balanceentry_and_more"),
        ("drivers", "0003_driver_gender"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        # WR-23 naming: kind -> trip_type
        migrations.RenameField("trip", "kind", "trip_type"),
        # WR-17 naming: is_pool -> shareable, RidePool -> PoolGroup, pool -> pool_group
        migrations.RenameField("trip", "is_pool", "shareable"),
        migrations.RenameModel("RidePool", "PoolGroup"),
        migrations.RenameField("trip", "pool", "pool_group"),
        migrations.RemoveField("trip", "seats"),
        migrations.AlterField(
            "poolgroup", "driver",
            models.ForeignKey(null=True, blank=True, on_delete=django.db.models.deletion.CASCADE,
                              related_name="pools", to="drivers.driver"),
        ),
        migrations.AddField("poolgroup", "matched_at", models.DateTimeField(null=True, blank=True)),
        migrations.AddField("trip", "pool_seat_fare",
                            models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)),
        # WR-18 / WR-19 / WR-21
        migrations.AddField("trip", "shared_with_contact", models.BooleanField(default=False)),
        migrations.AddField("trip", "preference_status", models.CharField(
            max_length=15, blank=True, default="",
            choices=[("", "None"), ("awaiting_rider", "Waiting for rider's decision"),
                     ("keep_waiting", "Rider chose to keep waiting"), ("relaxed", "Rider accepted any driver")])),
        migrations.AddField("trip", "voucher", models.ForeignKey(
            null=True, blank=True, on_delete=django.db.models.deletion.PROTECT, related_name="trips",
            to="organizations.ridevoucher")),
        migrations.AlterField("trip", "payment_method", models.CharField(
            max_length=15, default="cash",
            choices=[("cash", "Cash"), ("momo", "Mobile Money"), ("organization", "Billed to organization"),
                     ("voucher", "Organization voucher"), ("bundle", "Prepaid bundle")])),
        # WR-19: RidePreference -> TripPreference, plus the PRD's two preferences
        migrations.RenameModel("RidePreference", "TripPreference"),
        migrations.AlterField("trippreference", "user", models.OneToOneField(
            on_delete=django.db.models.deletion.CASCADE, related_name="trip_preference", to=settings.AUTH_USER_MODEL)),
        migrations.AddField("trippreference", "preferred_driver_gender", models.CharField(
            max_length=10, blank=True, default="",
            choices=[("", "No preference"), ("female", "Female"), ("male", "Male")])),
        migrations.AddField("trippreference", "prefer_previous_drivers", models.BooleanField(default=False)),
        # WR-23: delivery fields move into DeliveryDetail
        migrations.CreateModel(
            name="DeliveryDetail",
            fields=[
                ("id", models.UUIDField(primary_key=True, serialize=False, editable=False,
                                        default=__import__("uuid").uuid4)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("recipient_name", models.CharField(max_length=150)),
                ("recipient_phone", models.CharField(max_length=20)),
                ("package_description", models.CharField(max_length=255)),
                ("package_size", models.CharField(max_length=10, default="small", choices=[
                    ("small", "Small (fits in a bag)"), ("medium", "Medium (a box on the lap)"),
                    ("large", "Large (needs the rear space)")])),
                ("pickup_code", models.CharField(max_length=6)),
                ("dropoff_code", models.CharField(max_length=6)),
                ("pickup_confirmation_photo", models.URLField(blank=True)),
                ("dropoff_confirmation_photo", models.URLField(blank=True)),
                ("picked_up_at", models.DateTimeField(null=True, blank=True)),
                ("trip", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE,
                                              related_name="delivery", to="trips.trip")),
            ],
            options={"abstract": False},
        ),
        migrations.RunPython(move_delivery_fields, migrations.RunPython.noop),
        migrations.RemoveField("trip", "recipient_name"),
        migrations.RemoveField("trip", "recipient_phone"),
        migrations.RemoveField("trip", "package_description"),
        migrations.RemoveField("trip", "delivery_code"),
    ]
