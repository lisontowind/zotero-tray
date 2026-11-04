"""Install the harness (or final XPI with --package) into the running test instance."""
from pathlib import Path
import json
import subprocess
import sys
import zipfile
from marionette import Client

ROOT = Path(__file__).resolve().parents[1]
if "--package" in sys.argv:
    version = json.loads((ROOT / "addon" / "manifest.json").read_text(encoding="utf-8"))["version"]
    package = ROOT / "dist" / f"zotero-tray-{version}.xpi"
else:
    subprocess.run([sys.executable, str(ROOT / "scripts" / "prepare-test-profile.py")], check=True)
    package = ROOT / "artifacts" / "test-profile" / "harness.xpi"
    with zipfile.ZipFile(package, "w") as archive:
        for file in (package.parent / "harness").rglob("*"):
            if file.is_file():
                archive.write(file, file.relative_to(package.parent / "harness").as_posix())
client = Client()
try:
    client.require_profile(ROOT / "artifacts" / "test-profile" / "profile")
    print(client.call("Addon:Install", {"path": str(package), "temporary": False}))
finally:
    client.close()
