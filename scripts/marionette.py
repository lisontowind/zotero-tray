"""Small local-only Marionette client for the isolated Zotero test process."""
import json
import socket
import sys
import os
from pathlib import Path


class Client:
    def __init__(self, port=2829):
        self.socket = socket.create_connection(("127.0.0.1", port), timeout=20)
        self.socket.settimeout(25)
        self.sequence = 0
        self.receive()
        # Zotero has no Firefox browser-startup-finished notification. Create
        # the session, then explicitly select its chrome window while the
        # Firefox-specific initial-window wait remains pending.
        self.sequence += 1
        request = json.dumps([0, self.sequence, "WebDriver:NewSession", {}]).encode()
        self.socket.sendall(str(len(request)).encode() + b":" + request)
        self.call("Marionette:SetContext", {"value": "chrome"})
        handles = self.call("WebDriver:GetWindowHandles")
        self.call("WebDriver:SwitchToWindow", {"handle": (handles if isinstance(handles, list) else handles["value"])[0]})

    def receive(self):
        header = b""
        while not header.endswith(b":"):
            part = self.socket.recv(1)
            if not part:
                raise EOFError("Marionette closed")
            header += part
        length = int(header[:-1])
        body = b""
        while len(body) < length:
            part = self.socket.recv(length - len(body))
            if not part:
                raise EOFError("Marionette closed")
            body += part
        return json.loads(body)

    def call(self, name, params=None):
        if os.environ.get("MARIONETTE_TRACE"):
            print(name, file=sys.stderr, flush=True)
        self.sequence += 1
        data = json.dumps([0, self.sequence, name, params or {}]).encode()
        self.socket.sendall(str(len(data)).encode() + b":" + data)
        reply = self.receive()
        while reply[1] != self.sequence:
            reply = self.receive()
        if reply[2]:
            raise RuntimeError(json.dumps(reply[2], ensure_ascii=False))
        return reply[3]

    def script(self, source, args=None, asynchronous=False):
        result = self.call("WebDriver:ExecuteAsyncScript" if asynchronous else "WebDriver:ExecuteScript", {
            "script": source, "args": args or [], "newSandbox": False, "sandbox": "system", "scriptTimeout": 20000
        })
        return result.get("value", result)

    def require_profile(self, expected):
        result = self.call("WebDriver:GetCapabilities")
        capabilities = result.get("value", result)
        capabilities = capabilities.get("capabilities", capabilities)
        profile = capabilities.get("moz:profile")
        if not profile or Path(profile).resolve() != Path(expected).resolve():
            raise RuntimeError(f"Refusing to control unexpected profile: {profile}")

    def close(self):
        try:
            self.call("WebDriver:DeleteSession")
        finally:
            self.socket.close()


if __name__ == "__main__":
    client = Client()
    try:
        print(json.dumps(client.script(sys.stdin.read()), ensure_ascii=False, indent=2))
    finally:
        client.close()
