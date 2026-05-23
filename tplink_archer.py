import argparse
import base64
import getpass
import json
import os
import urllib.parse
import urllib.request


class ArcherProtocolError(RuntimeError):
    """Raised when router response cannot be processed."""


class ArcherClient:
    def __init__(self, host, username, password, timeout=10, use_https=False, opener=None):
        self.host = host
        self.username = username
        self._password = password
        self.timeout = timeout
        self.scheme = "https" if use_https else "http"
        self._stok = None
        self._opener = opener or urllib.request.build_opener(urllib.request.HTTPCookieProcessor())

    def _url(self, path):
        return f"{self.scheme}://{self.host}{path}"

    def _request_json(self, method, path, payload=None):
        body = None
        headers = {}
        if payload is not None:
            body = urllib.parse.urlencode(payload).encode("utf-8")
            headers["Content-Type"] = "application/x-www-form-urlencoded; charset=utf-8"
        request = urllib.request.Request(self._url(path), data=body, headers=headers, method=method)
        with self._opener.open(request, timeout=self.timeout) as response:
            content = response.read().decode("utf-8")
        try:
            return json.loads(content)
        except json.JSONDecodeError as error:
            raise ArcherProtocolError("Router returned invalid JSON") from error

    @staticmethod
    def _extract_stok(payload):
        if isinstance(payload, dict):
            if "stok" in payload:
                return payload["stok"]
            for value in payload.values():
                token = ArcherClient._extract_stok(value)
                if token:
                    return token
        elif isinstance(payload, list):
            for value in payload:
                token = ArcherClient._extract_stok(value)
                if token:
                    return token
        return None

    def login(self):
        if self._password is None:
            raise ArcherProtocolError("Password has already been cleared after previous login")
        encoded_password = base64.b64encode(self._password.encode("utf-8")).decode("ascii")
        payload = {
            "operation": "login",
            "username": self.username,
            "password": encoded_password,
        }
        response = self._request_json("POST", "/cgi-bin/luci/;stok=/login?form=login", payload=payload)
        token = self._extract_stok(response)
        if not token:
            raise ArcherProtocolError("Could not read session token from login response")
        self._stok = token
        self._password = None
        return token

    def read_data(self, form="all"):
        if not self._stok:
            self.login()
        encoded_form = urllib.parse.quote(str(form), safe="")
        path = f"/cgi-bin/luci/;stok={self._stok}/admin/status?form={encoded_form}"
        return self._request_json("GET", path)


def _build_argument_parser():
    parser = argparse.ArgumentParser(description="Read TP-Link Archer router data.")
    parser.add_argument("--host", required=True, help="Router host, for example 192.168.0.1")
    parser.add_argument("--username", default="admin", help="Router username")
    parser.add_argument("--password", help="Router password")
    parser.add_argument("--timeout", type=int, default=10, help="Request timeout in seconds")
    parser.add_argument("--https", action="store_true", help="Use HTTPS instead of HTTP")
    parser.add_argument("--form", default="all", help="Status form to read")
    return parser


def main():
    args = _build_argument_parser().parse_args()
    password = args.password or os.getenv("TPLINK_ARCHER_PASSWORD")
    if password is None:
        password = getpass.getpass("Router password: ")
    if not password:
        raise ArcherProtocolError("No password provided for authentication")
    client = ArcherClient(
        host=args.host,
        username=args.username,
        password=password,
        timeout=args.timeout,
        use_https=args.https,
    )
    print(json.dumps(client.read_data(form=args.form), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
