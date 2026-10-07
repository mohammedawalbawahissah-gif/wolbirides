from decimal import Decimal, InvalidOperation

from django.core.management.base import BaseCommand, CommandError

from drivers.models import RiderPassPlan


class Command(BaseCommand):
    help = ("Create (or reprice) the Day pass and Weekly pass. The weekly price defaults to 6x the daily "
            "price, so a full week costs one day less. Example: manage.py seed_rider_passes --daily 10")

    def add_arguments(self, parser):
        parser.add_argument("--daily", required=True, help="Day pass price in GH₵")
        parser.add_argument("--weekly", help="Weekly pass price in GH₵ (default: 6 x daily)")

    def handle(self, *args, **opts):
        try:
            daily = Decimal(opts["daily"]).quantize(Decimal("0.01"))
            weekly = Decimal(opts["weekly"]).quantize(Decimal("0.01")) if opts.get("weekly") else daily * 6
        except InvalidOperation as exc:
            raise CommandError("Prices must be numbers.") from exc
        if daily <= 0 or weekly <= 0:
            raise CommandError("Prices must be above zero.")
        for name, days, price in (("Day pass", 1, daily), ("Weekly pass", 7, weekly)):
            plan, created = RiderPassPlan.objects.update_or_create(
                name=name, defaults={"duration_days": days, "price": price, "active": True})
            self.stdout.write(f"{'Created' if created else 'Updated'} {plan}")
