import io
from unittest import mock
from urllib.parse import parse_qs, urlparse

from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from accounts.models import User
from core import storage
from drivers.models import Driver, Vehicle

R2 = dict(
    R2_ACCOUNT_ID="acct", R2_ACCESS_KEY_ID="key", R2_SECRET_ACCESS_KEY="secret",
    R2_BUCKET="wr-public", R2_PUBLIC_BASE_URL="https://files.example.com",
    R2_PRIVATE_BUCKET="wr-private", R2_SIGNED_URL_SECONDS=600,
)
PLAIN = "https://acct.r2.cloudflarestorage.com/wr-private/wolbirides/licence_document/abc.jpg"


def _png():
    buf = io.BytesIO(); Image.new("RGB", (4, 4), "red").save(buf, "PNG"); buf.seek(0); buf.name = "x.png"
    return buf


@override_settings(**R2)
class PrivateDocumentTests(TestCase):
    def setUp(self):
        storage._client = None  # signing is local; build a fresh client with these test settings
        self.rider_user = User.objects.create_user(phone="+233200000011", role="driver")
        self.driver = Driver.objects.create(user=self.rider_user, licence_number="L1", licence_document=PLAIN,
                                            ghana_card_document=PLAIN.replace("licence_document", "ghana_card_document"))
        Vehicle.objects.create(driver=self.driver, plate_number="GT-1-24", photo="https://files.example.com/car.jpg",
                               registration_document=PLAIN.replace("licence_document", "vehicle_registration_document"))
        self.admin = User.objects.create_user(phone="+233200000090", role="admin")

    def tearDown(self):
        storage._client = None

    def _as(self, user):
        c = APIClient(); c.force_authenticate(user); return c

    def assertSigned(self, url):
        q = parse_qs(urlparse(url).query)
        self.assertTrue(url.startswith("https://acct.r2.cloudflarestorage.com/wr-private/wolbirides/"), url)
        self.assertEqual(q["X-Amz-Expires"], ["600"])
        self.assertIn("X-Amz-Signature", q)

    def test_admin_review_gets_signed_links_for_every_private_document_but_a_plain_public_photo(self):
        row = self._as(self.admin).get("/api/admin/drivers/pending").data[0]
        self.assertSigned(row["licence_document"])
        self.assertSigned(row["ghana_card_document"])
        self.assertSigned(row["vehicles"][0]["registration_document"])
        self.assertEqual(row["vehicles"][0]["photo"], "https://files.example.com/car.jpg")

    def test_the_rider_sees_their_own_documents_signed_too(self):
        data = self._as(self.rider_user).get("/api/drivers/me").data
        self.assertSigned(data["licence_document"])
        self.assertSigned(data["ghana_card_document"])

    def test_the_stored_value_stays_the_plain_unsigned_address(self):
        self._as(self.admin).get("/api/admin/drivers/pending")
        self.driver.refresh_from_db()
        self.assertEqual(self.driver.licence_document, PLAIN)

    def test_other_users_cannot_reach_documents(self):
        passenger = User.objects.create_user(phone="+233200000077", role="passenger")
        other_rider = User.objects.create_user(phone="+233200000078", role="driver")
        for user in (passenger, other_rider):
            self.assertEqual(self._as(user).get("/api/admin/drivers/pending").status_code, 403)
        self.assertEqual(self._as(passenger).get("/api/drivers/me").status_code in (403, 404), True)
        # another rider's own profile shows only their own (empty) documents
        Driver.objects.create(user=other_rider, licence_number="L2")
        self.assertEqual(self._as(other_rider).get("/api/drivers/me").data["licence_document"], "")

    def test_saving_back_a_signed_link_stores_the_plain_address(self):
        signed = storage.sign(PLAIN)
        r = self._as(self.rider_user).patch("/api/drivers/me", {"ghana_card_document": signed}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.driver.refresh_from_db()
        self.assertEqual(self.driver.ghana_card_document, PLAIN)
        self.assertSigned(r.data["ghana_card_document"])

    def test_applying_with_signed_links_stores_plain_addresses(self):
        user = User.objects.create_user(phone="+233200000055", role="passenger")
        body = {"licence_number": "L9", "ghana_card_number": "GHA-123456789-0", "plate_number": "GT-9-24",
                "licence_document": storage.sign(PLAIN), "vehicle_registration_document": storage.sign(PLAIN)}
        r = self._as(user).post("/api/drivers/apply", body, format="json")
        self.assertIn(r.status_code, (200, 201), r.data)
        d = Driver.objects.get(user=user)
        self.assertEqual(d.licence_document, PLAIN)
        self.assertEqual(d.vehicles.first().registration_document, PLAIN)

    def test_other_urls_and_blanks_pass_through_untouched(self):
        self.assertEqual(storage.sign(""), "")
        self.assertEqual(storage.sign("https://files.example.com/a.jpg"), "https://files.example.com/a.jpg")
        self.assertEqual(storage.canonicalize("https://elsewhere.example.com/a.jpg?x=1"), "https://elsewhere.example.com/a.jpg?x=1")

    def test_documents_upload_to_the_private_bucket_and_photos_to_the_public_one(self):
        client = mock.Mock()
        api = self._as(User.objects.create_user(phone="+233200000066", role="passenger"))
        with mock.patch.object(storage, "_get_client", return_value=client):
            # sign() uses the same patched client, so give it a real-looking return
            client.generate_presigned_url.return_value = "https://signed.example/x?X-Amz-Signature=1"
            doc = api.post("/api/uploads/document", {"kind": "ghana_card_document", "file": _png()}, format="multipart")
            photo = api.post("/api/uploads/document", {"kind": "profile_photo", "file": _png()}, format="multipart")
        self.assertEqual((doc.status_code, photo.status_code), (201, 201))
        (doc_args, doc_kwargs), (photo_args, photo_kwargs) = [c[0:2] for c in client.upload_fileobj.call_args_list]
        self.assertEqual(doc_args[1], "wr-private")
        self.assertEqual(doc_kwargs["ExtraArgs"]["CacheControl"], "private, no-store")
        self.assertEqual(photo_args[1], "wr-public")
        self.assertTrue(photo.data["url"].startswith("https://files.example.com/wolbirides/profile_photo/"))
        self.assertIn("X-Amz-Signature", doc.data["url"])

    @override_settings(R2_PRIVATE_BUCKET="")
    def test_documents_are_refused_not_stored_publicly_when_the_private_bucket_is_missing(self):
        api = self._as(User.objects.create_user(phone="+233200000066", role="passenger"))
        r = api.post("/api/uploads/document", {"kind": "ghana_card_document", "file": _png()}, format="multipart")
        self.assertEqual(r.status_code, 503)
