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

    def create_superuser(self, phone, name="Admin", password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("role", User.Role.ADMIN)
        user = self._create_user(phone, name, **extra_fields)
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
        DRIVER = "driver", "Driver"
        ADMIN = "admin", "Admin"
        SUPPORT = "support", "Support Agent"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    phone = models.CharField(max_length=20, unique=True, db_index=True)
    name = models.CharField(max_length=150, blank=True)
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.PASSENGER)
    otp_verified = models.BooleanField(default=False)

    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = UserManager()

    USERNAME_FIELD = "phone"
    REQUIRED_FIELDS = []

    class Meta:
        indexes = [models.Index(fields=["role", "is_active"])]

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
