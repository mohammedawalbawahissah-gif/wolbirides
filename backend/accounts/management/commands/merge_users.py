"""
Merge a duplicate account into the one you want to keep.

    python manage.py merge_users --keep +233509231963 --merge 0509231963          # dry run
    python manage.py merge_users --keep +233509231963 --merge 0509231963 --apply  # do it

Everything that points at the duplicate (trips, saved places, notifications,
tickets, incidents, schedules, profiles…) is moved to the kept account.
The duplicate is deactivated and its phone/email freed, not deleted, so the
merge can be audited afterwards. Runs in one transaction: all or nothing.

Only you can decide which account is the "real" one — this tool never picks.
"""
from django.core.management.base import BaseCommand, CommandError
from django.db import IntegrityError, transaction

from accounts.models import User
from core.models import AuditLog


def _find(identifier):
    user = User.objects.filter(phone=identifier).first() or User.objects.filter(email__iexact=identifier).first()
    if not user:
        try:
            user = User.objects.filter(id=identifier).first()
        except Exception:
            user = None
    if not user:
        raise CommandError(f"No user found for '{identifier}' (tried phone, email, id).")
    return user


class Command(BaseCommand):
    help = "Move everything from a duplicate user onto the account you keep, then deactivate the duplicate."

    def add_arguments(self, parser):
        parser.add_argument("--keep", required=True, help="Phone, email or id of the account to keep")
        parser.add_argument("--merge", required=True, help="Phone, email or id of the duplicate to fold in")
        parser.add_argument("--apply", action="store_true", help="Actually write changes (default is a dry run)")

    def handle(self, *args, keep, merge, apply, **opts):
        keep_user, dup = _find(keep), _find(merge)
        if keep_user.id == dup.id:
            raise CommandError("--keep and --merge are the same account.")

        self.stdout.write(f"Keep : {keep_user.id} phone={keep_user.phone} email={keep_user.email} role={keep_user.role}")
        self.stdout.write(f"Merge: {dup.id} phone={dup.phone} email={dup.email} role={dup.role}")
        if keep_user.role != dup.role:
            self.stdout.write(self.style.WARNING(f"Roles differ ({keep_user.role} vs {dup.role}); keeping {keep_user.role}."))

        plan = []
        for rel in User._meta.related_objects:
            if not (rel.one_to_many or rel.one_to_one):
                continue
            model, field = rel.related_model, rel.field.name
            if model is AuditLog:
                continue  # history stays attributed to whoever actually acted
            count = model._default_manager.filter(**{field: dup}).count()
            if count:
                plan.append((model, field, count, rel.one_to_one))
                self.stdout.write(f"  {model._meta.label}.{field}: {count} row(s)")
                if rel.one_to_one and model._default_manager.filter(**{field: keep_user}).exists():
                    raise CommandError(
                        f"Both accounts have a {model._meta.label}. Resolve that by hand first; refusing to guess."
                    )
        if not plan:
            self.stdout.write("  (nothing points at the duplicate)")

        if not apply:
            self.stdout.write(self.style.WARNING("Dry run only. Re-run with --apply to merge."))
            return

        with transaction.atomic():
            moved_total, dropped_total = 0, 0
            for model, field, _, _ in plan:
                for obj in model._default_manager.filter(**{field: dup}):
                    setattr(obj, field, keep_user)
                    try:
                        with transaction.atomic():
                            obj.save()
                        moved_total += 1
                    except IntegrityError:
                        # e.g. a notification preference the kept account already has
                        obj.delete()
                        dropped_total += 1

            if not keep_user.email and dup.email:
                keep_user.email, dup.email = dup.email, None
            if not keep_user.name and dup.name:
                keep_user.name = dup.name
            if not keep_user.emergency_contact_phone and dup.emergency_contact_phone:
                keep_user.emergency_contact_name = dup.emergency_contact_name
                keep_user.emergency_contact_phone = dup.emergency_contact_phone

            old_phone = dup.phone
            dup.phone = f"merged:{dup.id.hex}"[:64]
            dup.email = None
            dup.is_active = False
            dup.save()
            keep_user.save()

            AuditLog.objects.create(
                actor=None, action="user_merged", target_model="accounts.User", target_id=str(keep_user.id),
                metadata={"merged_user_id": str(dup.id), "merged_phone": old_phone,
                          "rows_moved": moved_total, "rows_dropped_as_duplicates": dropped_total},
            )

        self.stdout.write(self.style.SUCCESS(
            f"Merged. {moved_total} row(s) moved, {dropped_total} duplicate row(s) dropped. "
            f"Duplicate deactivated (was {old_phone})."
        ))
