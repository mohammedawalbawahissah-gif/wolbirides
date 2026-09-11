from rest_framework.permissions import BasePermission


class IsAdminRole(BasePermission):
    """
    Our admins are User rows with role='admin', not necessarily is_staff
    (OTP-created accounts never set is_staff). DRF's built-in IsAdminUser
    checks is_staff, which doesn't match our auth model — use this instead
    anywhere an endpoint should be admin-only.
    """

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.role == "admin")
