"""Verify the security-relevant distribution boundary and reproducible output."""
import importlib.util
import json
from pathlib import Path
import re
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("builder", ROOT / "scripts" / "build.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class PackageTests(unittest.TestCase):
    def test_reproducible_source_only_package(self):
        package = builder.build()
        first = package.read_bytes()
        self.assertEqual(first, builder.build().read_bytes())
        with zipfile.ZipFile(package) as archive:
            self.assertEqual(set(archive.namelist()), {
                "manifest.json", "bootstrap.js", "content/tray-worker.js", "content/appearance.js", "LICENSE"
            })
            manifest = json.loads(archive.read("manifest.json"))
            self.assertEqual(manifest["applications"]["zotero"]["strict_max_version"], "10.0.*")
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
