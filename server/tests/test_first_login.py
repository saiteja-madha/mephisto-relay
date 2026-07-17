import unittest

from unittest.mock import patch

from server.browser_launcher import cdp_is_reachable, local_cdp_address


class FirstLoginTests(unittest.TestCase):
    def test_recognizes_local_http_cdp_endpoint(self):
        self.assertEqual(local_cdp_address("http://127.0.0.1:9222"), ("127.0.0.1", 9222))
        self.assertEqual(local_cdp_address("http://localhost:9333"), ("localhost", 9333))

    def test_remote_or_websocket_endpoint_is_not_local(self):
        self.assertIsNone(local_cdp_address("wss://browser.example.test/cdp"))
        self.assertIsNone(local_cdp_address("http://browser.example.test:9222"))

    @patch("server.browser_launcher.urlopen")
    def test_detects_reachable_cdp_endpoint(self, urlopen):
        urlopen.return_value.__enter__.return_value.status = 200
        self.assertTrue(cdp_is_reachable("127.0.0.1", 9222))


if __name__ == "__main__":
    unittest.main()
