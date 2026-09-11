from django.utils import timezone

from incidents.models import Incident


def create_incident(reported_by, severity, description, trip=None):
    """
    PRD Section 4.3 / blueprint WR-06.3: P0/P1 incidents trigger immediate
    escalation, which at MVP scale means auto-suspending the involved
    driver pending human review rather than leaving them dispatchable.
    """
    incident = Incident.objects.create(
        reported_by=reported_by, severity=severity, description=description, trip=trip
    )
    if severity in (Incident.Severity.P0_CRITICAL, Incident.Severity.P1_SERIOUS) and trip and trip.driver:
        from drivers.models import Driver

        Driver.objects.filter(id=trip.driver_id).update(
            verification_status=Driver.VerificationStatus.SUSPENDED, is_online=False
        )
    return incident


def resolve_incident(incident):
    incident.status = Incident.Status.RESOLVED
    incident.resolved_at = timezone.now()
    incident.save(update_fields=["status", "resolved_at", "updated_at"])
    return incident
