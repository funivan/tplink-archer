import base64
import json
import unittest

from tplink_archer import ArcherClient, ArcherProtocolError


class _Response:
    def __init__(self, payload):
        self._payload = payload

    def read(self):
        return self._payload.encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        return False


class _Opener:
    def __init__(self, responses):
        self.responses = [
            _Response(item if isinstance(item, str) else json.dumps(item)) for item in responses
        ]
        self.requests = []

    def open(self, request, timeout=None):
        self.requests.append((request, timeout))
        return self.responses.pop(0)


class ArcherClientTests(unittest.TestCase):
    def test_read_data_authenticates_and_uses_stok(self):
        opener = _Opener(
            [
                {"error_code": 0, "data": {"stok": "stok-value"}},
                {"network": {"up": True}},
            ]
        )
        client = ArcherClient(
            host="192.168.0.1",
            username="admin",
            password="secret",
            opener=opener,
        )

        payload = client.read_data()

        self.assertEqual({"network": {"up": True}}, payload)
        self.assertEqual(2, len(opener.requests))

        login_request, _ = opener.requests[0]
        self.assertIn("/cgi-bin/luci/;stok=/login?form=login", login_request.full_url)
        login_data = login_request.data.decode("utf-8")
        self.assertIn("operation=login", login_data)
        self.assertIn("username=admin", login_data)
        encoded_password = base64.b64encode(b"secret").decode("ascii")
        self.assertIn(f"password={encoded_password}", login_data)

        status_request, _ = opener.requests[1]
        self.assertIn(";stok=stok-value/admin/status?form=all", status_request.full_url)

    def test_login_fails_without_stok(self):
        opener = _Opener([{"error_code": 0}])
        client = ArcherClient(
            host="192.168.0.1",
            username="admin",
            password="secret",
            opener=opener,
        )

        with self.assertRaises(ArcherProtocolError):
            client.login()

    def test_request_json_raises_error_for_invalid_json(self):
        opener = _Opener(["not-json"])
        client = ArcherClient(
            host="192.168.0.1",
            username="admin",
            password="secret",
            opener=opener,
        )

        with self.assertRaises(ArcherProtocolError):
            client._request_json("GET", "/status")

    def test_extract_stok_from_nested_list(self):
        payload = {"data": [{"x": 1}, {"nested": [{"stok": "list-token"}]}]}
        self.assertEqual("list-token", ArcherClient._extract_stok(payload))

    def test_read_data_uses_existing_stok(self):
        opener = _Opener([{"network": {"up": True}}])
        client = ArcherClient(
            host="192.168.0.1",
            username="admin",
            password="secret",
            opener=opener,
        )
        client._stok = "existing-token"

        payload = client.read_data()

        self.assertEqual({"network": {"up": True}}, payload)
        self.assertEqual(1, len(opener.requests))
        status_request, _ = opener.requests[0]
        self.assertIn(";stok=existing-token/admin/status?form=all", status_request.full_url)


if __name__ == "__main__":
    unittest.main()
