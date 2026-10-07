"""Bulk-add searchable places from a CSV.

    python manage.py import_places places.csv            (add --dry-run to check without saving)

Columns (header row required): zone, name, aliases, area, lat, lng
  zone     the service zone's name exactly as in ops, or empty for "every zone"
  aliases  other names, separated by ; (optional)
  area     shown under the name (optional)
Re-running is safe: a place with the same zone and name is updated, not duplicated.
"""
import csv
from decimal import Decimal, InvalidOperation

from django.core.management.base import BaseCommand, CommandError

from zones.models import Place, ServiceZone


class Command(BaseCommand):
    help = "Add or update searchable places from a CSV file."

    def add_arguments(self, parser):
        parser.add_argument("csv_path")
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, csv_path, dry_run=False, **opts):
        try:
            fh = open(csv_path, newline="", encoding="utf-8-sig")
        except OSError as exc:
            raise CommandError(f"Can't open {csv_path}: {exc}") from exc
        zones = {z.name.lower(): z for z in ServiceZone.objects.all()}
        created = updated = 0
        problems = []
        rows = []
        with fh:
            reader = csv.DictReader(fh)
            missing = {"zone", "name", "lat", "lng"} - set(reader.fieldnames or [])
            if missing:
                raise CommandError("The CSV needs these columns: zone, name, aliases, area, lat, lng. Missing: " + ", ".join(sorted(missing)))
            for n, row in enumerate(reader, start=2):
                name = (row.get("name") or "").strip()
                zone_name = (row.get("zone") or "").strip()
                try:
                    lat, lng = Decimal((row.get("lat") or "").strip()), Decimal((row.get("lng") or "").strip())
                except InvalidOperation:
                    problems.append(f"line {n}: '{name}' has no valid lat/lng")
                    continue
                if not name:
                    problems.append(f"line {n}: no name")
                elif not (-90 <= lat <= 90 and -180 <= lng <= 180):
                    problems.append(f"line {n}: '{name}' has coordinates outside the world")
                elif zone_name and zone_name.lower() not in zones:
                    problems.append(f"line {n}: '{name}' names a zone that doesn't exist: {zone_name}")
                else:
                    rows.append((zones.get(zone_name.lower()), name, ", ".join(a.strip() for a in (row.get("aliases") or "").replace(";", ",").split(",") if a.strip()),
                                 (row.get("area") or "").strip(), lat, lng))
        for zone, name, aliases, area, lat, lng in rows:
            if dry_run:
                created += 0 if Place.objects.filter(zone=zone, name__iexact=name).exists() else 1
                continue
            _, was_created = Place.objects.update_or_create(
                zone=zone, name=name,
                defaults={"aliases": aliases, "area": area, "latitude": lat, "longitude": lng, "is_active": True})
            created += was_created
            updated += not was_created
        for p in problems:
            self.stderr.write("SKIPPED " + p)
        verb = "would add" if dry_run else "added"
        self.stdout.write(f"{verb} {created}" + ("" if dry_run else f", updated {updated}") + f", skipped {len(problems)}.")
