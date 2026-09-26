from django.test import TestCase

# Create your tests here.


class DriverGenderPrivacyTests(TestCase):
    def test_gender_only_visible_to_the_driver(self):
        from rest_framework.test import APIClient

        from accounts.models import User
        from drivers.models import Driver
        from drivers.serializers import DriverSerializer

        u = User.objects.create_user(phone="+233200000011", role="driver")
        d = Driver.objects.create(user=u, licence_number="L1")
        c = APIClient(); c.force_authenticate(u)
        self.assertEqual(c.patch("/api/drivers/me", {"gender": "female"}, format="json").data["gender"], "female")
        self.assertNotIn("gender", DriverSerializer(Driver.objects.get(id=d.id)).data)
