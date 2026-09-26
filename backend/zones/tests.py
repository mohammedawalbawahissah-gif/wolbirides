from django.test import TestCase

# Create your tests here.


class ZoneApiTests(TestCase):
    def test_zone_list_includes_growth_fields(self):
        from decimal import Decimal

        from rest_framework.test import APIClient

        from accounts.models import User
        from zones.models import PickupPoint, ServiceZone

        zone = ServiceZone.objects.create(name="UDS", boundary={}, base_fare=Decimal("5"), per_km_rate=Decimal("2"))
        PickupPoint.objects.create(zone=zone, name="Main gate", latitude=9.4, longitude=-0.9, sponsor_name="Campus Prints")
        c = APIClient(); c.force_authenticate(User.objects.create_user(phone="+233200000001", role="passenger"))
        data = c.get("/api/zones").data[0]
        self.assertEqual(data["pool_max_riders"], 2)
        self.assertEqual(data["pickup_points"][0]["sponsor_name"], "Campus Prints")

    def test_security_contact_is_admin_only(self):
        from decimal import Decimal

        from rest_framework.test import APIClient

        from accounts.models import User
        from zones.models import ServiceZone

        ServiceZone.objects.create(name="UDS", boundary={}, base_fare=Decimal("5"), per_km_rate=Decimal("2"),
                                   security_contact_phone="+233300000000")
        c = APIClient(); c.force_authenticate(User.objects.create_user(phone="+233200000001", role="passenger"))
        self.assertNotIn("security_contact_phone", c.get("/api/zones").data[0])
        c.force_authenticate(User.objects.create_user(phone="+233200000099", role="admin"))
        self.assertEqual(c.get("/api/admin/zones").data[0]["security_contact_phone"], "+233300000000")
