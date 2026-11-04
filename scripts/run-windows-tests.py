"""Run native tests in a separate Zotero profile and quit that instance normally."""
import argparse
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time

from marionette import Client

ROOT = Path(__file__).resolve().parents[1]
TEST = ROOT / "artifacts" / "test-profile"


def run(script, *args):
    subprocess.run([sys.executable, "-B", str(ROOT / "scripts" / script), *args], cwd=ROOT, check=True)


def wait_for_server(process):
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Test Zotero exited with code {process.returncode}")
        try:
            with socket.create_connection(("127.0.0.1", 2829), timeout=1):
                return
        except OSError:
            time.sleep(0.2)
    raise TimeoutError("Test Zotero did not start Marionette; see artifacts/test-profile/native-stdout.log")


def quit_instance():
    client = Client()
    try:
        client.require_profile(TEST / "profile")
        client.call("Marionette:Quit", {"flags": ["eAttemptQuit"]})
    finally:
        client.socket.close()


def exercise(executable, log_name, scripts):
    startup = subprocess.STARTUPINFO()
    startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startup.wShowWindow = subprocess.SW_HIDE
    with (TEST / log_name).open("w", encoding="utf-8") as log:
        process = subprocess.Popen([
            str(executable), "-no-remote", "-profile", str(TEST / "profile"),
            "--marionette", "--remote-allow-system-access", "-ZoteroDebugText"
        ], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, startupinfo=startup,
            env=dict(os.environ, MOZ_NO_REMOTE="1"))
        try:
            wait_for_server(process)
            for script in scripts:
                run(script)
        finally:
            if process.poll() is None:
                try:
                    # Give a successful harness quit time to finish first.
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    quit_instance()
                    process.wait(timeout=30)
        if process.returncode != 0:
            raise RuntimeError(f"Test Zotero exited with code {process.returncode}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zotero", type=Path, default=Path(r"C:\Program Files\Zotero\zotero.exe"))
    args = parser.parse_args()
    if sys.platform != "win32" or not args.zotero.is_file():
        parser.error("Windows and an installed Zotero 10 are required; use --zotero for its executable")
    # Never connect to an existing debug instance or alter its test profile.
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 2829))
    subprocess.run(["node", "--test", *map(str, sorted((ROOT / "tests").glob("*.test.cjs")))], cwd=ROOT, check=True)
    subprocess.run([sys.executable, "-B", "-m", "unittest", "discover", "-s", "tests", "-p", "test_package.py"], cwd=ROOT, check=True)
    run("prepare-test-profile.py", "--install")
    exercise(args.zotero, "native-stdout.log", ["integration-test.py", "quit-test-profile.py"])
    manifest = json.loads((ROOT / "addon" / "manifest.json").read_text(encoding="utf-8"))
    package = ROOT / "dist" / f"zotero-tray-{manifest['version']}.xpi"
    installed = TEST / "profile" / "extensions" / (manifest["applications"]["zotero"]["id"] + ".xpi")
    shutil.copyfile(package, installed)
    exercise(args.zotero, "production-stdout.log", ["verify-production.py"])
    print("PASS native integration tests, production XPI and normal Zotero shutdown")


if __name__ == "__main__":
    main()
