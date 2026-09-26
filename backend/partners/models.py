"""
WR-24 Local partnerships: campus-area businesses (eateries, shops, hostels,
print centres) that appear as named destinations and fund promo codes.
Partners get a report of rides and redemptions they drove.
"""
from django.conf import settings
from django.db import models

from core.models import TimeStampedModel


class Partner(TimeStampedModel):
    class Category(models.TextChoices):
        FOOD = "food", "Food & drink"
        SHOP = "shop", "Shop"
        HOSTEL = "hostel", "Hostel"
        SERVICES = "services", "Services"
        OTHER = "other", "Other"

    name = models.CharField(max_length=150)
    category = models.CharField(max_length=20, choices=Category.choices, default=Category.OTHER)
    zone = models.ForeignKey("zones.ServiceZone", on_delete=models.PROTECT, related_name="partners")
    lat = models.DecimalField(max_digits=9, decimal_places=6)
    lng = models.DecimalField(max_digits=9, decimal_places=6)
    address = models.CharField(max_length=255, blank=True)
    offer_text = models.CharField(max_length=200, blank=True, help_text='Shown to riders, e.g. "10% off with code WAAKYE10"')
    contact_name = models.CharField(max_length=150, blank=True)
    contact_phone = models.CharField(max_length=20, blank=True)
    active = models.BooleanField(default=True)

    def __str__(self):
        return self.name


class PromoCode(TimeStampedModel):
    class DiscountType(models.TextChoices):
        PERCENT = "percent", "Percent off"
        FLAT = "flat", "Flat GH₵ off"

    code = models.CharField(max_length=30, unique=True)
    partner = models.ForeignKey(Partner, on_delete=models.SET_NULL, null=True, blank=True, related_name="promos")
    description = models.CharField(max_length=200, blank=True)
    discount_type = models.CharField(max_length=10, choices=DiscountType.choices)
    value = models.DecimalField(max_digits=8, decimal_places=2)
    max_discount = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    min_fare = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    max_uses = models.PositiveIntegerField(null=True, blank=True)
    max_uses_per_user = models.PositiveIntegerField(default=1)
    destination_must_be_partner = models.BooleanField(
        default=False, help_text="Only valid for trips ending at this partner (within 200m)"
    )
    valid_from = models.DateTimeField(null=True, blank=True)
    valid_until = models.DateTimeField(null=True, blank=True)
    active = models.BooleanField(default=True)

    def save(self, *args, **kwargs):
        self.code = self.code.strip().upper()
        super().save(*args, **kwargs)

    def __str__(self):
        return self.code


class PromoRedemption(TimeStampedModel):
    class Status(models.TextChoices):
        APPLIED = "applied", "Applied"
        VOID = "void", "Void (trip cancelled)"

    promo = models.ForeignKey(PromoCode, on_delete=models.PROTECT, related_name="redemptions")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="promo_redemptions")
    trip = models.OneToOneField("trips.Trip", on_delete=models.CASCADE, related_name="promo_redemption")
    amount = models.DecimalField(max_digits=8, decimal_places=2)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.APPLIED)


class SponsoredPlacement(TimeStampedModel):
    """
    WR-24: a clearly labelled sponsored card, sold directly to a local business.
    Every rider in the zone sees the same placement. There is no per-rider
    targeting, and no rider data is used to choose what's shown.
    """

    zone = models.ForeignKey("zones.ServiceZone", on_delete=models.CASCADE, null=True, blank=True,
                             related_name="placements", help_text="Blank = every zone")
    partner = models.ForeignKey(Partner, on_delete=models.SET_NULL, null=True, blank=True, related_name="placements")
    title = models.CharField(max_length=100)
    description = models.CharField(max_length=240, blank=True)
    image_url = models.URLField(blank=True)
    link_url = models.URLField(blank=True)
    sponsor_name = models.CharField(max_length=150)
    active_from = models.DateTimeField()
    active_to = models.DateTimeField()
    price_paid = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    class Meta:
        ordering = ["-active_from"]

    def __str__(self):
        return f"{self.sponsor_name}: {self.title}"
