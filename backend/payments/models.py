from django.db import models

from core.models import TimeStampedModel


class Payment(TimeStampedModel):
    """
    PRD Section 5 & Section 12 (open question: cash-trip commission
    mechanism still needs a field-validated answer — this model supports
    either method today so that decision doesn't require a schema change).
    """

    class Method(models.TextChoices):
        CASH = "cash", "Cash"
        MOMO = "momo", "Mobile Money"
        HUBTEL = "hubtel", "Hubtel"
        ORGANIZATION = "organization", "Billed to organization"  # WR-21
        VOUCHER = "voucher", "Organization voucher"  # WR-21
        BUNDLE = "bundle", "Prepaid bundle"  # WR-22

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SUCCESS = "success", "Success"
        FAILED = "failed", "Failed"
        REFUNDED = "refunded", "Refunded"

    trip = models.OneToOneField("trips.Trip", on_delete=models.PROTECT, related_name="payment")
    method = models.CharField(max_length=15, choices=Method.choices)

    class FundingSource(models.TextChoices):
        CASH = "cash", "Cash"
        MOMO = "momo", "Mobile Money"
        HUBTEL = "hubtel", "Hubtel"
        ORGANIZATION_ACCOUNT = "organization_account", "Organization account"
        ORGANIZATION_VOUCHER = "organization_voucher", "Organization voucher"
        RIDE_BUNDLE = "ride_bundle", "Ride bundle"

    # WR-21/22: who actually paid, alongside how it was collected.
    funding_source = models.CharField(max_length=25, choices=FundingSource.choices, default=FundingSource.CASH)
    amount = models.DecimalField(max_digits=8, decimal_places=2)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    provider_reference = models.CharField(max_length=100, blank=True)
    payer_phone = models.CharField(max_length=20, blank=True)
    provider_status = models.CharField(max_length=30, blank=True)  # MTN's raw status, for the audit trail
    failure_reason = models.CharField(max_length=255, blank=True)
    confirmed_by = models.CharField(max_length=20, blank=True)  # e.g. "driver" for cash

    def __str__(self):
        return f"{self.method}:{self.status} {self.amount} for {self.trip_id}"


class Payout(TimeStampedModel):
    """Driver earnings payout batch — WR-14 automated weekly payouts."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"  # generated, awaiting admin approval during the pilot
        APPROVED = "approved", "Approved"  # queued for disbursement
        PROCESSING = "processing", "Processing"  # transfer accepted by MoMo, awaiting final status
        PAID = "paid", "Paid"
        FAILED = "failed", "Failed"

    driver = models.ForeignKey("drivers.Driver", on_delete=models.PROTECT, related_name="payouts")
    period_start = models.DateField()
    period_end = models.DateField()
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    # Snapshotted at generation time so a later commission-rate change never
    # retroactively alters what a historical payout record says was taken.
    commission_rate_snapshot = models.DecimalField(max_digits=5, decimal_places=4, default=0)
    # Per-trip breakdown: [{"trip_id": ..., "fare": "15.00", "commission": "0.00", "net": "15.00", "completed_at": ...}, ...]
    # so a driver sees exactly which rides make up the total, not one opaque number.
    line_items = models.JSONField(default=list, blank=True)
    provider = models.CharField(max_length=10, blank=True, help_text="momo or hubtel — set when disbursed")
    provider_reference = models.CharField(max_length=100, blank=True)
    failure_reason = models.CharField(max_length=255, blank=True)
    retry_count = models.PositiveSmallIntegerField(default=0)

    def __str__(self):
        return f"Payout<{self.amount}> {self.driver_id} [{self.period_start}–{self.period_end}]"
