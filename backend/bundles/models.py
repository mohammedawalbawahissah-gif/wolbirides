"""
WR-22 Prepaid ride bundles, e.g. "20 campus rides for GH₵150, valid 30 days".

A bundle is a count of rides, not a money balance: nothing is ever
withdrawn or transferred, each ride just uses one credit, capped by the
plan's max fare. That keeps it closer to a prepaid pass than a wallet,
but it is still customer prepayment, so confirm with your legal/
compliance advisor (WR-10, Bank of Ghana) before selling at scale.
"""
from django.conf import settings
from django.db import models

from core.models import TimeStampedModel


class BundlePlan(TimeStampedModel):
    name = models.CharField(max_length=100)
    ride_count = models.PositiveIntegerField()
    price = models.DecimalField(max_digits=8, decimal_places=2)
    max_fare_per_ride = models.DecimalField(
        max_digits=8, decimal_places=2, help_text="Rides costing more than this can't use the bundle"
    )
    # WR-22: blank = never expires. Anything shorter than a full academic term
    # (BUNDLE_MIN_TERM_DAYS) must be acknowledged by the buyer at purchase.
    valid_days = models.PositiveIntegerField(null=True, blank=True, default=None)
    active = models.BooleanField(default=True)

    def __str__(self):
        return f"{self.name} ({self.ride_count} rides, GH₵{self.price})"


class PassengerBundle(TimeStampedModel):
    class Status(models.TextChoices):
        PENDING_PAYMENT = "pending_payment", "Awaiting payment"
        ACTIVE = "active", "Active"
        EXHAUSTED = "exhausted", "Used up"
        EXPIRED = "expired", "Expired"
        CANCELLED = "cancelled", "Cancelled"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="bundles")
    plan = models.ForeignKey(BundlePlan, on_delete=models.PROTECT, related_name="purchases")
    # Snapshotted so later plan edits never change what someone already bought.
    rides_total = models.PositiveIntegerField()
    rides_remaining = models.PositiveIntegerField()
    price_paid = models.DecimalField(max_digits=8, decimal_places=2)
    max_fare_per_ride = models.DecimalField(max_digits=8, decimal_places=2)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING_PAYMENT)
    payment_method = models.CharField(max_length=20, blank=True)
    payment_reference = models.CharField(max_length=100, blank=True)
    activated_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    short_expiry_acknowledged = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]


class BundleRedemption(TimeStampedModel):
    class Status(models.TextChoices):
        RESERVED = "reserved", "Reserved"
        USED = "used", "Used"
        RELEASED = "released", "Released"

    bundle = models.ForeignKey(PassengerBundle, on_delete=models.PROTECT, related_name="redemptions")
    trip = models.OneToOneField("trips.Trip", on_delete=models.PROTECT, related_name="bundle_redemption")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.RESERVED)
