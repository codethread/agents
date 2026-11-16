"""Pure network receipt and bookmark-page contracts; no Tailscale installation needed."""
import unittest

from server import document_title, document_urls, index_body, tailscale_base_from_status


class PublicationTests(unittest.TestCase):
    def test_tailscale_url_uses_reported_self_name_and_dedicated_port(self):
        status = {"BackendState": "Running", "Self": {
            "DNSName": "workstation.example.ts.net.", "TailscaleIPs": ["100.80.1.2", "fd7a:115c:a1e0::1"],
        }}
        self.assertEqual(tailscale_base_from_status(status, {"shields-up": False}), "http://workstation.example.ts.net:8765")

    def test_unavailable_or_malformed_identity_cannot_produce_a_guessed_url(self):
        for status in [None, {}, {"BackendState": "Stopped"}, {"BackendState": "Running"},
                       {"BackendState": "Running", "Self": {"DNSName": "", "TailscaleIPs": ["100.80.1.2"]}},
                       {"BackendState": "Running", "Self": {"DNSName": "wrong.example/path", "TailscaleIPs": ["100.80.1.2"]}},
                       {"BackendState": "Running", "Self": {"DNSName": "host.example", "TailscaleIPs": ["fd7a:115c:a1e0::1"]}},
                       {"BackendState": "Running", "Self": {"DNSName": "host.example", "TailscaleIPs": ["invalid"]}}]:
            with self.subTest(status=status), self.assertRaises(ValueError):
                tailscale_base_from_status(status, {"shields-up": False})

    def test_incoming_connections_must_be_allowed_even_when_self_identity_is_valid(self):
        status = {"BackendState": "Running", "Self": {
            "DNSName": "workstation.example.ts.net.", "TailscaleIPs": ["100.80.1.2"],
        }}
        with self.assertRaisesRegex(ValueError, "incoming Tailscale connections are blocked"):
            tailscale_base_from_status(status, {"shields-up": True})
        for preferences in [None, {}, {"shields-up": "false"}]:
            with self.subTest(preferences=preferences), self.assertRaisesRegex(ValueError, "could not verify"):
                tailscale_base_from_status(status, preferences)

    def test_document_receipt_preserves_local_lan_and_distinguishes_bookmark(self):
        urls = document_urls("questionnaire-abc", "192.168.1.2", "http://host.example.ts.net:8765")
        self.assertEqual(urls, {
            "localUrl": "http://localhost:8765/documents/questionnaire-abc",
            "localHomeUrl": "http://localhost:8765/",
            "lanUrl": "http://192.168.1.2:8765/documents/questionnaire-abc",
            "lanHomeUrl": "http://192.168.1.2:8765/",
            "tailscaleUrl": "http://host.example.ts.net:8765/documents/questionnaire-abc",
            "tailscaleHomeUrl": "http://host.example.ts.net:8765/",
        })
        offline = document_urls("report", "192.168.1.2", None)
        self.assertIsNone(offline["tailscaleUrl"])
        self.assertIsNone(offline["tailscaleHomeUrl"])
        self.assertEqual(offline["localUrl"], "http://localhost:8765/documents/report")

    def test_bookmark_page_displays_titles_and_submission_status_safely(self):
        body = index_body([
            {"id": "new-questionnaire", "title": 'Pick <one> & "discuss"', "status": "Awaiting answers"},
            {"id": "old-questionnaire", "title": "Earlier workshop", "status": "Answers submitted"},
        ])
        self.assertIn('href="/documents/new-questionnaire"', body)
        self.assertIn('Pick &lt;one&gt; &amp; &quot;discuss&quot;', body)
        self.assertLess(body.index("new-questionnaire"), body.index("old-questionnaire"))
        self.assertIn("Awaiting answers", body)
        self.assertIn("Answers submitted", body)
        self.assertIn("No documents published yet", index_body([]))

    def test_published_titles_are_readable_without_reinterpreting_html(self):
        title = document_title('<title>A &amp; B\n&lt;script&gt;</title>', "report")
        self.assertEqual(title, "A & B\n<script>")
        self.assertEqual(document_title("<p>No title</p>", "report"), "report")


if __name__ == "__main__":
    unittest.main()
