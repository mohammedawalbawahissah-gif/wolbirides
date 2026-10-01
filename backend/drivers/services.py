from django.db import transaction

from drivers.models import Driver, Vehicle


@transaction.atomic
def _normalize(phone):
    from accounts.services import normalize_phone

    return normalize_phone(phone)


def submit_driver_application(user, data):
    """
    Creates the Driver + Vehicle records in pending status. Verification
    (WR-07.2 gate) is an admin action — a driver cannot self-verify, and
    `set_driver_online` below refuses to bring an unverified driver online
    even if the client sends the request.
    """
    if user.role == "passenger":
        # A brand-new account defaults to 'passenger' from OTP signup; once
        # someone applies to drive, the client apps need role='driver' to
        # route them to the driver experience instead of the passenger one.
        user.role = "driver"
        user.save(update_fields=["role"])

    driver, _created = Driver.objects.update_or_create(
        user=user,
        defaults={
            "licence_number": data["licence_number"],
            "licence_expiry": data.get("licence_expiry"),
            "licence_document": data.get("licence_document", ""),
            "emergency_contact_name": data.get("emergency_contact_name", ""),
            "emergency_contact_phone": data.get("emergency_contact_phone", ""),
            "payout_phone": _normalize(data["payout_phone"]) if data.get("payout_phone") else "",
            "payout_provider": data.get("payout_provider") or Driver.PayoutProvider.MOMO,
            "verification_status": Driver.VerificationStatus.PENDING,
        },
    )
    Vehicle.objects.update_or_create(
        driver=driver,
        plate_number=data["plate_number"],
        defaults={
            "photo": data.get("vehicle_photo", ""),
            "registration_document": data.get("vehicle_registration_document", ""),
        },
    )
    return driver


def set_driver_online(driver, is_online, zone=None):
    """Enforces the WR-07.2 verification gate before a driver can receive requests."""
    if is_online and driver.verification_status != Driver.VerificationStatus.VERIFIED:
        raise PermissionError("Rider is not verified and cannot go online")
    driver.is_online = is_online
    if zone is not None:
        driver.current_zone = zone
    driver.save(update_fields=["is_online", "current_zone", "updated_at"])
    if not is_online:
        take_driver_offline(driver, reason="went_offline")
    return driver


def take_driver_offline(driver, reason="offline"):
    """
    The single way a driver stops receiving work: offline in the database,
    removed from live dispatch in Redis, and told over their socket (their app
    stops pinging). Used when they go offline, and on every suspension
    (SOS / P0-P1 incident, or an admin action).
    """
    import logging

    from asgiref.sync import async_to_sync
    from channels.layers import get_channel_layer

    from trips.matching import driver_group_name, remove_driver_location_sync

    Driver.objects.filter(id=driver.id).update(is_online=False)
    try:
        remove_driver_location_sync(str(driver.user_id), str(driver.current_zone_id) if driver.current_zone_id else None)
    except Exception:
        logging.getLogger(__name__).warning("Couldn't clear live location for rider %s", driver.id)
    try:
        async_to_sync(get_channel_layer().group_send)(
            driver_group_name(str(driver.user_id)), {"type": "force_offline", "reason": reason}
        )
    except Exception:
        logging.getLogger(__name__).warning("Couldn't notify rider %s to go offline", driver.id)
