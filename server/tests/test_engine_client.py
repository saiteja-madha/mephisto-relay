from io import BytesIO
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from server.engine_client import RemoteEngineClient


class EngineClientTests(unittest.TestCase):
    def test_includes_json_error_detail_from_engine(self):
        error = HTTPError(
            "http://127.0.0.1:9090/analyse",
            500,
            "Internal Server Error",
            {},
            BytesIO(b'{"error":"engine process exited","type":"EngineTerminatedError"}'),
        )
        with patch("server.engine_client.urlopen", side_effect=error):
            with self.assertRaisesRegex(
                RuntimeError,
                "EngineTerminatedError: engine process exited",
            ):
                RemoteEngineClient("http://127.0.0.1:9090").analyse("some fen")


if __name__ == "__main__":
    unittest.main()
