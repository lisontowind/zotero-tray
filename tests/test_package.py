"""Verify the security-relevant distribution boundary and reproducible output."""
import importlib.util
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("builder", ROOT / "scripts" / "build.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class PackageTests(unittest.TestCase):
    def test_release_tag_must_match_version(self):
        result = subprocess.run([sys.executable, str(ROOT / "scripts" / "build.py"), "--tag", "v0.0.0"],
                                capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Release tag must be", result.stderr)

    def test_reproducible_source_only_package(self):
        package = builder.build()
        first = package.read_bytes()
        update_bytes = (package.parent / "updates.json").read_bytes()
        self.assertEqual(first, builder.build().read_bytes())
        self.assertEqual(update_bytes, (package.parent / "updates.json").read_bytes())
        with zipfile.ZipFile(package) as archive:
            self.assertEqual(set(archive.namelist()), {
                "manifest.json", "bootstrap.js", "content/tray-worker.js", "content/appearance.js", "icons/icon.svg", "LICENSE"
            })
            manifest = json.loads(archive.read("manifest.json"))
            self.assertEqual(manifest["applications"]["zotero"]["strict_max_version"], "10.0.*")
            self.assertEqual(manifest["author"], "lisontowind")
            repository = manifest["homepage_url"]
            self.assertEqual(manifest["applications"]["zotero"]["update_url"],
                             repository + "/releases/latest/download/updates.json")
            for icon in manifest["icons"].values():
                self.assertIn(icon, archive.namelist())
            update = json.loads(update_bytes)["addons"][manifest["applications"]["zotero"]["id"]]["updates"][0]
            self.assertEqual(update["version"], manifest["version"])
            self.assertEqual(update["update_hash"], "sha256:" + hashlib.sha256(first).hexdigest())
            self.assertEqual(update["update_link"],
                             f"{repository}/releases/download/v{manifest['version']}/{package.name}")
            self.assertEqual(update["applications"]["zotero"], {
                key: manifest["applications"]["zotero"][key]
                for key in ("strict_min_version", "strict_max_version")
            })
            for name in archive.namelist():
                if not name.endswith(".js"):
                    continue
                source = archive.read(name).decode("utf-8")
                self.assertNotIn("test-fail", source)
                self.assertNotIn("command.json", source)
                self.assertNotRegex(source, re.compile(
                    r"Subprocess|@mozilla\.org/process/util|child_process|new\s+(?:WebSocket|XMLHttpRequest)|\bfetch\s*\("
                ))


if __name__ == "__main__":
    unittest.main()
