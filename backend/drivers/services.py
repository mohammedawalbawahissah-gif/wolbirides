from django.db import transaction

from drivers.models import Driver, Vehicle


@transaction.atomic
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
        raise PermissionError("Driver is not verified and cannot go online")
    driver.is_online = is_online
    if zone is not None:
        driver.current_zone = zone
    driver.save(update_fields=["is_online", "current_zone", "updated_at"])
    return driver
