"""Verify normal Quit Zotero routing and cooperative native shutdown."""
import json
from pathlib import Path
import time

ROOT = Path(__file__).resolve().parents[1]
TEST = ROOT / "artifacts" / "test-profile"
marker = TEST / "shutdown.json"
if marker.is_file():
    marker.unlink()
request = {"id": str(time.time_ns()), "type": "menu-command", "command": 2}
temp = TEST / "command.tmp"
temp.write_text(json.dumps(request), encoding="utf-8")
temp.replace(TEST / "command.json")
deadline = time.monotonic() + 20
while time.monotonic() < deadline:
    if marker.exists():
        result = json.loads(marker.read_text(encoding="utf-8"))
        assert result["cleaned"], result
        (ROOT / "artifacts" / "normal-quit-result.json").write_text(
            json.dumps({"passed": True, "nativeResourcesCleaned": True}), encoding="utf-8")
        print("PASS tray Quit command completed normal Zotero shutdown and native cleanup")
        break
    time.sleep(0.1)
else:
    raise TimeoutError("Zotero did not finish normal quit")
