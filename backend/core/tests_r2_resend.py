import io
from unittest import mock

from django.core import mail
from django.core.mail import send_mail
from django.test import SimpleTestCase, TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from accounts.models import User
from core import storage

R2 = dict(
    R2_ACCOUNT_ID="acct", R2_ACCESS_KEY_ID="key", R2_SECRET_ACCESS_KEY="secret",
    R2_BUCKET="wr-files", R2_PUBLIC_BASE_URL="https://files.example.com/",
)


def _image_bytes(fmt="JPEG"):
    buf = io.BytesIO()
    Image.new("RGB", (4, 4), "red").save(buf, fmt)
    buf.seek(0)
    buf.name = "x." + fmt.lower()
    return buf


class UploadToR2Tests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(phone="0240000001", password="pw-12345-xx", role="passenger")
        self.api = APIClient()
        self.api.force_authenticate(self.user)

    @override_settings(R2_ACCOUNT_ID="", R2_ACCESS_KEY_ID="", R2_SECRET_ACCESS_KEY="", R2_BUCKET="", R2_PUBLIC_BASE_URL="")
    def test_not_configured_is_503(self):
        r = self.api.post("/api/uploads/document", {"kind": "profile_photo", "file": _image_bytes()}, format="multipart")
        self.assertEqual(r.status_code, 503)

    @override_settings(**R2)
    def test_image_is_stored_with_detected_type_and_public_url(self):
        client = mock.Mock()
        with mock.patch.object(storage, "_get_client", return_value=client):
            r = self.api.post("/api/uploads/document", {"kind": "profile_photo", "file": _image_bytes("PNG")}, format="multipart")
        self.assertEqual(r.status_code, 201)
        self.assertRegex(r.data["url"], r"^https://files\.example\.com/wolbirides/profile_photo/[0-9a-f-]{36}\.png$")
        args, kwargs = client.upload_fileobj.call_args
        self.assertEqual(args[1], "wr-files")
        self.assertEqual(kwargs["ExtraArgs"]["ContentType"], "image/png")

    @override_settings(**R2)
    def test_pdf_allowed_for_documents_only(self):
        pdf = io.BytesIO(b"%PDF-1.4 test"); pdf.name = "d.pdf"
        client = mock.Mock()
        with mock.patch.object(storage, "_get_client", return_value=client):
            ok = self.api.post("/api/uploads/document", {"kind": "licence_document", "file": pdf}, format="multipart")
            pdf2 = io.BytesIO(b"%PDF-1.4 test"); pdf2.name = "d.pdf"
            bad = self.api.post("/api/uploads/document", {"kind": "profile_photo", "file": pdf2}, format="multipart")
        self.assertEqual(ok.status_code, 201)
        self.assertTrue(ok.data["url"].endswith(".pdf"))
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(client.upload_fileobj.call_count, 1)

    @override_settings(**R2)
    def test_disguised_file_is_rejected_and_nothing_stored(self):
        fake = io.BytesIO(b"<html><script>alert(1)</script></html>"); fake.name = "evil.jpg"
        client = mock.Mock()
        with mock.patch.object(storage, "_get_client", return_value=client):
            r = self.api.post("/api/uploads/document", {"kind": "profile_photo", "file": fake}, format="multipart")
        self.assertEqual(r.status_code, 400)
        client.upload_fileobj.assert_not_called()

    @override_settings(**R2)
    def test_storage_failure_is_502(self):
        client = mock.Mock(); client.upload_fileobj.side_effect = RuntimeError("boom")
        with mock.patch.object(storage, "_get_client", return_value=client):
            r = self.api.post("/api/uploads/document", {"kind": "profile_photo", "file": _image_bytes()}, format="multipart")
        self.assertEqual(r.status_code, 502)


@override_settings(EMAIL_BACKEND="core.email_backend.ResendEmailBackend", RESEND_API_KEY="re_test",
                   DEFAULT_FROM_EMAIL="WolbiRides <no-reply@example.com>")
class ResendBackendTests(SimpleTestCase):
    def test_sends_through_resend_api(self):
        with mock.patch("core.email_backend.requests.post") as post:
            post.return_value.raise_for_status = lambda: None
            n = send_mail("Your code", "123456", None, ["ama@uds.edu.gh"])
        self.assertEqual(n, 1)
        _, kwargs = post.call_args
        self.assertEqual(post.call_args[0][0], "https://api.resend.com/emails")
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer re_test")
        self.assertEqual(kwargs["json"], {"from": "WolbiRides <no-reply@example.com>", "to": ["ama@uds.edu.gh"],
                                          "subject": "Your code", "text": "123456"})

    def test_api_error_raises_unless_fail_silently(self):
        with mock.patch("core.email_backend.requests.post") as post:
            post.return_value.raise_for_status.side_effect = RuntimeError("422")
            with self.assertRaises(RuntimeError):
                send_mail("s", "b", None, ["a@b.com"])
            self.assertEqual(send_mail("s", "b", None, ["a@b.com"], fail_silently=True), 0)

    @override_settings(RESEND_API_KEY="")
    def test_missing_key_is_an_error_not_a_silent_success(self):
        with self.assertRaises(RuntimeError):
            send_mail("s", "b", None, ["a@b.com"])

