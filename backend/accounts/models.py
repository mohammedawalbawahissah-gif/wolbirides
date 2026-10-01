import uuid

from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models

from core.models import TimeStampedModel


class UserManager(BaseUserManager):
    """
    Users are authenticated by phone number + OTP (Africa's Talking), not
    email/password. See PRD Section 7: POST /api/auth/otp/request|verify.
    """

    use_in_migrations = True

    def _create_user(self, phone, name="", role="passenger", **extra_fields):
        if not phone:
            raise ValueError("Users must have a phone number")
        user = self.model(phone=phone, name=name, role=role, **extra_fields)
        user.set_unusable_password()  # OTP-based auth — no password stored
        user.save(using=self._db)
        return user

    def create_user(self, phone, name="", role="passenger", **extra_fields):
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        return self._create_user(phone, name, role, **extra_fields)

    def create_user_with_email(self, email, password, name="", role="passenger", phone=None, **extra_fields):
        """
        Email+password signup path — sits alongside the original phone+OTP
        path rather than replacing it, since phone remains the identifier
        SMS dispatch/matching use throughout the rest of the codebase.
        """
        if not email:
            raise ValueError("Users must have an email address")
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        # phone is the historical USERNAME_FIELD/unique column — email-only
        # signups get a private placeholder that can't collide, can't be
        # dialed/texted, and is obviously not a real number if ever displayed.
        # NOTE: this placeholder used to overflow phone's old max_length=20
        # (a "email:<uuid4>" string is 42 chars) — three real accounts in
        # production data were silently truncated/oversized under SQLite,
        # which doesn't enforce column length, and would have hard-failed
        # on Postgres. Fixed by widening the column (see migration) and
        # using uuid4().hex (32 chars, no dashes) to keep this value short.
        user = self.model(
            phone=phone or f"email:{uuid.uuid4().hex}",
            email=self.normalize_email(email),
            name=name,
            role=role,
            **extra_fields,
        )
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, phone, email=None, name="Admin", password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("role", User.Role.ADMIN)
        user = self._create_user(phone, name, **extra_fields)
        if email:
            user.email = self.normalize_email(email)
        if password:
            user.set_password(password)
        user.save(using=self._db)
        return user


class User(AbstractBaseUser, PermissionsMixin, TimeStampedModel):
    """
    Core identity for every actor in the system (PRD Section 5: User entity).
    Role-specific data (Driver, StudentProfile) lives in one-to-one satellite
    tables rather than being crammed onto this model.
    """

    class Role(models.TextChoices):
        PASSENGER = "passenger", "Passenger"
        DRIVER = "driver", "Rider"
        ADMIN = "admin", "Admin"
        SUPPORT = "support", "Admin (support)"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    phone = models.CharField(max_length=64, unique=True, db_index=True)
    email = models.EmailField(unique=True, null=True, blank=True, db_index=True)
    name = models.CharField(max_length=150, blank=True)
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.PASSENGER)
    otp_verified = models.BooleanField(default=False)
    profile_photo = models.URLField(blank=True)
    # WR-18: one trusted contact who gets an SMS if this user raises an SOS.
    emergency_contact_name = models.CharField(max_length=150, blank=True)
    emergency_contact_phone = models.CharField(max_length=20, blank=True)

    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = UserManager()

    USERNAME_FIELD = "phone"
    # email is required so a superuser created via `createsuperuser` can
    # actually sign into the admin dashboard, which authenticates by email
    # + password (not phone) since the WR UX overhaul.
    REQUIRED_FIELDS = ["email"]

    class Meta:
        indexes = [models.Index(fields=["role", "is_active"])]

    @property
    def real_phone(self):
        """A dialable number, or "" for accounts that only have a private placeholder
        (email-only signups store "email:<hash>", merged duplicates "merged:<...>")."""
        p = self.phone or ""
        return "" if p.startswith(("email:", "merged:")) else p

    def __str__(self):
        return f"{self.name or 'Unnamed'} ({self.phone})"


class OTPRequest(TimeStampedModel):
    """
    Short-lived OTP codes issued via Africa's Talking. Kept in Postgres (not
    Redis) so verification survives worker restarts; TTL enforced in code via
    expires_at, plus a periodic cleanup task.
    """

    phone = models.CharField(max_length=20, db_index=True)
    code_hash = models.CharField(max_length=128)
    expires_at = models.DateTimeField()
    consumed = models.BooleanField(default=False)
    attempt_count = models.PositiveSmallIntegerField(default=0)

    class Meta:
        indexes = [models.Index(fields=["phone", "consumed"])]


class EmailOTPRequest(TimeStampedModel):
    """
    Mirrors OTPRequest but for the email+password signup flow's ownership
    check — kept as a separate model rather than overloading OTPRequest.phone
    since the two channels (SMS vs SMTP) have different senders and this
    keeps that boundary obvious in the schema.
    """

    class Purpose(models.TextChoices):
        SIGNUP = "signup", "Sign-up verification"
        PASSWORD_RESET = "password_reset", "Password reset"

    email = models.EmailField(db_index=True)
    # A sign-up code must never work as a password-reset code, or the reverse.
    purpose = models.CharField(max_length=20, choices=Purpose.choices, default=Purpose.SIGNUP)
    code_hash = models.CharField(max_length=128)
    expires_at = models.DateTimeField()
    consumed = models.BooleanField(default=False)
    attempt_count = models.PositiveSmallIntegerField(default=0)

    class Meta:
        indexes = [models.Index(fields=["email", "consumed"])]


class SavedAddress(TimeStampedModel):
    """A passenger's saved pickup/drop-off shortcuts (WR UX overhaul, item 5)."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="saved_addresses")
    label = models.CharField(max_length=50)  # e.g. "Home", "Campus hostel"
    lat = models.DecimalField(max_digits=9, decimal_places=6)
    lng = models.DecimalField(max_digits=9, decimal_places=6)
    address_text = models.CharField(max_length=255, blank=True)
    # WR-13: incremented whenever a trip request explicitly references this
    # address as pickup or destination — feeds "usual places" ranking in
    # the app without needing to guess from raw trip coordinates.
    usage_count = models.PositiveIntegerField(default=0)
    last_used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]


class RecurringRideSchedule(TimeStampedModel):
    """
    WR-13: a passenger's standing ride pattern (e.g. "campus run, Mon/Wed/Fri
    7:45am"). Deliberately reminder-only, never auto-booking — see the
    PRD's guardrail: auto-charging or auto-requesting a ride without an
    explicit per-trip confirmation removes real consent over a real cost.
    """

    class DayOfWeek(models.IntegerChoices):
        MONDAY = 0, "Monday"
        TUESDAY = 1, "Tuesday"
        WEDNESDAY = 2, "Wednesday"
        THURSDAY = 3, "Thursday"
        FRIDAY = 4, "Friday"
        SATURDAY = 5, "Saturday"
        SUNDAY = 6, "Sunday"

    passenger = models.ForeignKey(User, on_delete=models.CASCADE, related_name="recurring_ride_schedules")
    pickup = models.ForeignKey(SavedAddress, on_delete=models.CASCADE, related_name="+")
    destination = models.ForeignKey(SavedAddress, on_delete=models.CASCADE, related_name="+")
    days_of_week = models.JSONField(default=list, help_text="List of DayOfWeek integers, e.g. [0, 2, 4]")
    time_of_day = models.TimeField()
    active = models.BooleanField(default=True)
    last_reminded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["time_of_day"]

    def __str__(self):
        return f"{self.passenger_id}: {self.pickup.label} -> {self.destination.label} @ {self.time_of_day}"


class StudentProfile(TimeStampedModel):
    """PRD Section 5 — StudentProfile entity."""

    class VerificationStatus(models.TextChoices):
        PENDING = "pending", "Pending"
        VERIFIED = "verified", "Verified"
        REJECTED = "rejected", "Rejected"

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="student_profile")
    student_id_number = models.CharField(max_length=50, blank=True)
    verification_status = models.CharField(
        max_length=20, choices=VerificationStatus.choices, default=VerificationStatus.PENDING
    )
    home_zone = models.ForeignKey(
        "zones.ServiceZone", on_delete=models.SET_NULL, null=True, blank=True, related_name="resident_students"
    )

    def __str__(self):
        return f"StudentProfile<{self.user.phone}>"
