"""
WR-21 Institutional accounts: an organization (a department, hostel, NGO,
company) pays for its members' rides. Members choose "Bill to <org>" when
booking; ops invoices the organization monthly.
"""
from django.conf import settings
from django.db import models

from core.models import TimeStampedModel


class Organization(TimeStampedModel):
    name = models.CharField(max_length=150, unique=True)
    billing_contact_name = models.CharField(max_length=150, blank=True)
    billing_email = models.EmailField(blank=True)
    billing_phone = models.CharField(max_length=20, blank=True)
    monthly_budget = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True, help_text="Total spend cap per calendar month; blank = no cap"
    )
    # WR-21: pre-funded organizations draw rides from this balance; blank means
    # the organization is invoiced monthly instead.
    prepaid_balance = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    active = models.BooleanField(default=True)

    def __str__(self):
        return self.name


class OrganizationMember(TimeStampedModel):
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="members")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="organization_memberships")
    monthly_limit = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True, help_text="Per-member cap per month; blank = no cap"
    )
    active = models.BooleanField(default=True)

    class Meta:
        unique_together = [("organization", "user")]


class Invoice(TimeStampedModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SENT = "sent", "Sent"
        PAID = "paid", "Paid"

    organization = models.ForeignKey(Organization, on_delete=models.PROTECT, related_name="invoices")
    period_start = models.DateField()
    period_end = models.DateField(help_text="Exclusive")
    total = models.DecimalField(max_digits=10, decimal_places=2)
    line_items = models.JSONField(default=list, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT)
    paid_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = [("organization", "period_start", "period_end")]
        ordering = ["-period_start"]


class RideVoucher(TimeStampedModel):
    """WR-21: a code an organization hands out. Worth either a GH₵ amount or a number of rides.

    Single-holder: the first person to redeem it owns it. Rides paid with it
    are billed to the organization like member rides.
    """

    class Kind(models.TextChoices):
        VALUE = "value", "GH₵ value"
        RIDES = "rides", "Number of rides"

    organization = models.ForeignKey(Organization, on_delete=models.PROTECT, related_name="vouchers")
    code = models.CharField(max_length=20, unique=True)
    kind = models.CharField(max_length=10, choices=Kind.choices)
    value = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    value_remaining = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    ride_count = models.PositiveIntegerField(null=True, blank=True)
    rides_remaining = models.PositiveIntegerField(null=True, blank=True)
    redeemed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="vouchers"
    )
    redeemed_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    voided = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]


class BalanceEntry(TimeStampedModel):
    """Every change to a pre-funded organization's balance, so it can be reconciled."""

    organization = models.ForeignKey(Organization, on_delete=models.PROTECT, related_name="balance_entries")
    amount = models.DecimalField(max_digits=10, decimal_places=2)  # + top-up, - ride
    reason = models.CharField(max_length=40)
    reference = models.CharField(max_length=120, blank=True)
    trip = models.ForeignKey("trips.Trip", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")

    class Meta:
        ordering = ["-created_at"]
