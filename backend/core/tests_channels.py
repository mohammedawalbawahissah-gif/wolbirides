from unittest import mock

from django.core import mail
from django.test import TestCase, override_settings

from accounts.models import User
from core.channels import channels_for, email_parts, sms_text
from core.models import Notification, notify
from core.tasks import deliver_channels


@override_settings(NOTIFY_CHANNELS_ENABLED=True, PASSENGER_WEB_URL="https://app.example.com")
class ChannelPolicyTests(TestCase):
    def test_defaults_by_category_and_explicit_override(self):
        self.assertEqual(channels_for("trip"), ())
        self.assertEqual(channels_for("system"), ("email",))
        self.assertEqual(channels_for("payout"), ("email", "sms"))
        self.assertEqual(channels_for(Notification.Category.DRIVER), ("email",))
        self.assertEqual(channels_for("trip", ("sms",)), ("sms",))
        self.assertEqual(channels_for("trip", ("sms", "carrier-pigeon", "email")), ("email", "sms"))
        self.assertEqual(channels_for("system", ()), ())

    @override_settings(NOTIFY_CHANNELS_ENABLED=False)
    def test_switch_turns_everything_off(self):
        self.assertEqual(channels_for("payout", ("email", "sms")), ())

    def test_sms_is_one_short_message(self):
        n = Notification(title="Rider assigned", body="x" * 400)
        text = sms_text(n)
        self.assertLessEqual(len(text), 160)
        self.assertTrue(text.startswith("WolbiRides: Rider assigned"))
        self.assertEqual(sms_text(Notification(title="Trip cancelled", body="Rider unavailable")),
                         "WolbiRides: Trip cancelled. Rider unavailable")

    def test_email_links_only_for_passengers(self):
        p = User.objects.create_user(phone="+233200000010", role="passenger")
        d = User.objects.create_user(phone="+233200000011", role="driver")
        subject, body = email_parts(Notification(user=p, title="Rider assigned", body="Kofi is on the way.", link="/trip/abc"))
        self.assertEqual(subject, "WolbiRides: Rider assigned")
        self.assertIn("https://app.example.com/trip/abc", body)
        self.assertNotIn("http", email_parts(Notification(user=d, title="Pass active", link="/profile"))[1])


@override_settings(NOTIFY_CHANNELS_ENABLED=True)
class QueueingTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(phone="+233200000020", role="passenger")

    def test_notify_queues_only_the_chosen_channels_after_commit(self):
        with mock.patch("core.tasks.deliver_channels.delay") as delay, self.captureOnCommitCallbacks(execute=True):
            n = notify(self.user, "Rider assigned", "Kofi is on the way.", category="trip", channels=("sms",))
        delay.assert_called_once_with(str(n.id), ["sms"])

    def test_trip_pings_without_a_choice_stay_bell_only(self):
        with mock.patch("core.tasks.deliver_channels.delay") as delay, self.captureOnCommitCallbacks(execute=True):
            notify(self.user, "No matching rider", category="trip")
        delay.assert_not_called()

    def test_account_notices_email_by_default(self):
        with mock.patch("core.tasks.deliver_channels.delay") as delay, self.captureOnCommitCallbacks(execute=True):
            n = notify(self.user, "Your support request is resolved", category="system")
        delay.assert_called_once_with(str(n.id), ["email"])

    def test_a_broker_outage_never_breaks_the_caller(self):
        with mock.patch("core.tasks.deliver_channels.delay", side_effect=RuntimeError("broker down")), \
             self.captureOnCommitCallbacks(execute=True):
            n = notify(self.user, "Payout sent", category="payout")
        self.assertIsNotNone(n)
        self.assertTrue(Notification.objects.filter(id=n.id).exists())

    def test_opted_out_optional_category_sends_nothing(self):
        from core.models import NotificationPreference

        NotificationPreference.objects.create(user=self.user, category="recurring_reminder", enabled=False)
        with mock.patch("core.tasks.deliver_channels.delay") as delay, self.captureOnCommitCallbacks(execute=True):
            self.assertIsNone(notify(self.user, "Reminder", category="recurring_reminder", channels=("sms", "email")))
        delay.assert_not_called()


class DeliveryTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user_with_email("ama@uds.edu.gh", "pw-12345678", name="Ama", phone="+233200000030")

    def _note(self, user=None):
        return Notification.objects.create(user=user or self.user, title="Payout sent", body="GH₵120.00 is in your wallet.", category="payout")

    def test_email_and_sms_both_go_out_once(self):
        n = self._note()
        with mock.patch("accounts.services._send_sms") as sms:
            result = deliver_channels.apply(args=[str(n.id), ["email", "sms"]]).get()
            again = deliver_channels.apply(args=[str(n.id), ["email", "sms"]]).get()
        self.assertEqual(result, {"email": True, "sms": True})
        self.assertEqual(again, {})
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["ama@uds.edu.gh"])
        self.assertEqual(mail.outbox[0].subject, "WolbiRides: Payout sent")
        sms.assert_called_once_with("+233200000030", "WolbiRides: Payout sent. GH₵120.00 is in your wallet.")
        n.refresh_from_db()
        self.assertIsNotNone(n.email_sent_at)
        self.assertIsNotNone(n.sms_sent_at)

    def test_users_without_the_address_are_skipped_quietly(self):
        phone_only = User.objects.create_user(phone="+233200000031", role="passenger")
        email_only = User.objects.create_user_with_email("kojo@uds.edu.gh", "pw-12345678", name="Kojo")  # placeholder phone
        with mock.patch("accounts.services._send_sms") as sms:
            r1 = deliver_channels.apply(args=[str(self._note(phone_only).id), ["email", "sms"]]).get()
            r2 = deliver_channels.apply(args=[str(self._note(email_only).id), ["email", "sms"]]).get()
        self.assertEqual(r1, {"sms": True})
        self.assertEqual(r2, {"email": True})
        sms.assert_called_once_with("+233200000031", mock.ANY)
        self.assertEqual([m.to for m in mail.outbox], [["kojo@uds.edu.gh"]])

    def test_a_failed_channel_is_retried_without_resending_the_other(self):
        n = self._note()
        with mock.patch("accounts.services._send_sms", side_effect=RuntimeError("AT down")) as sms:
            outcome = deliver_channels.apply(args=[str(n.id), ["email", "sms"]])
        self.assertTrue(outcome.failed())  # asks to be retried
        n.refresh_from_db()
        self.assertIsNotNone(n.email_sent_at)  # the email that worked is stamped
        self.assertIsNone(n.sms_sent_at)
        self.assertEqual(len(mail.outbox), 1)
        with mock.patch("accounts.services._send_sms") as sms2:  # the retry
            deliver_channels.apply(args=[str(n.id), ["email", "sms"]]).get()
        sms2.assert_called_once()
        self.assertEqual(len(mail.outbox), 1)  # the email was not sent twice
        self.assertEqual(sms.call_count, 4)  # the first try plus its three automatic retries

    def test_deactivated_users_and_deleted_notifications_are_ignored(self):
        n = self._note()
        self.user.is_active = False
        self.user.save()
        with mock.patch("accounts.services._send_sms") as sms:
            self.assertEqual(deliver_channels.apply(args=[str(n.id), ["email", "sms"]]).get(), {})
            self.assertEqual(deliver_channels.apply(args=["00000000-0000-0000-0000-000000000000", ["sms"]]).get(), {})
        sms.assert_not_called()
        self.assertEqual(len(mail.outbox), 0)
