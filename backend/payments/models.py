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

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SUCCESS = "success", "Success"
        FAILED = "failed", "Failed"
        REFUNDED = "refunded", "Refunded"

    trip = models.OneToOneField("trips.Trip", on_delete=models.PROTECT, related_name="payment")
    method = models.CharField(max_length=10, choices=Method.choices)
    amount = models.DecimalField(max_digits=8, decimal_places=2)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    provider_reference = models.CharField(max_length=100, blank=True)

    def __str__(self):
        return f"{self.method}:{self.status} {self.amount} for {self.trip_id}"


class Payout(TimeStampedModel):
    """Driver earnings payout batch — Phase 2 automation, but modeled now per PRD Section 5."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        PAID = "paid", "Paid"
        FAILED = "failed", "Failed"

    driver = models.ForeignKey("drivers.Driver", on_delete=models.PROTECT, related_name="payouts")
    period_start = models.DateField()
    period_end = models.DateField()
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)

    def __str__(self):
        return f"Payout<{self.amount}> {self.driver_id} [{self.period_start}–{self.period_end}]"
