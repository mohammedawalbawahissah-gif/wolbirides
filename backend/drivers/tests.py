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


class AdminApplicationReviewTests(TestCase):
    """The desk needs the actual documents to review, not just text fields — this is the fix
    for licence_document silently never having been sent to admin at all."""

    def test_the_admin_list_includes_the_licence_photo_and_payout_details(self):
        from rest_framework.test import APIClient

        from accounts.models import User
        from drivers.models import Driver, Vehicle

        applicant = User.objects.create_user(phone="+233200000011", name="Kofi", role="driver")
        driver = Driver.objects.create(user=applicant, licence_number="L1",
                                       licence_document="https://res.cloudinary.com/licence.jpg",
                                       payout_phone="+233209998888", payout_provider="hubtel")
        Vehicle.objects.create(driver=driver, plate_number="GT-1-24", photo="https://res.cloudinary.com/car.jpg",
                               registration_document="https://res.cloudinary.com/reg.pdf")
        admin = User.objects.create_user(phone="+233200000090", name="Ops", role="admin")
        c = APIClient(); c.force_authenticate(admin)
        row = c.get("/api/admin/drivers/pending").data[0]
        self.assertEqual(row["licence_document"], "https://res.cloudinary.com/licence.jpg")
        self.assertEqual(row["vehicles"][0]["photo"], "https://res.cloudinary.com/car.jpg")
        self.assertEqual(row["vehicles"][0]["registration_document"], "https://res.cloudinary.com/reg.pdf")
        self.assertEqual((row["payout_phone"], row["payout_provider"]), ("+233209998888", "hubtel"))


class PayoutSelfServiceTests(TestCase):
    """A verified rider can change where they're paid at any time, not only at application."""

    def test_a_driver_can_set_their_own_payout_phone_and_provider(self):
        from rest_framework.test import APIClient

        from accounts.models import User
        from drivers.models import Driver

        u = User.objects.create_user(phone="+233200000011", role="driver")
        Driver.objects.create(user=u, licence_number="L1")
        c = APIClient(); c.force_authenticate(u)
        r = c.patch("/api/drivers/me", {"payout_provider": "hubtel", "payout_phone": "0209998888"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual((r.data["payout_phone"], r.data["payout_provider"]), ("+233209998888", "hubtel"))

    def test_a_bad_provider_is_rejected(self):
        from rest_framework.test import APIClient

        from accounts.models import User
        from drivers.models import Driver

        u = User.objects.create_user(phone="+233200000012", role="driver")
        Driver.objects.create(user=u, licence_number="L1")
        c = APIClient(); c.force_authenticate(u)
        self.assertEqual(c.patch("/api/drivers/me", {"payout_provider": "cash"}, format="json").status_code, 400)
