"""Real Zotero tests through the isolated harness. No real library is accessed."""
import json
from pathlib import Path
import time

ROOT = Path(__file__).resolve().parents[1]
TEST = ROOT / "artifacts" / "test-profile"
results = []


def command(kind, **extra):
    request = {"id": str(time.time_ns()), "type": kind, **extra}
    temp = TEST / "command.tmp"
    temp.write_text(json.dumps(request), encoding="utf-8")
    # IOUtils briefly opens the command file without FILE_SHARE_DELETE on
    # Windows. Retry atomic publication rather than racing that reader.
    publish_deadline = time.monotonic() + 2
    while True:
        try:
            temp.replace(TEST / "command.json")
            break
        except PermissionError:
            if time.monotonic() >= publish_deadline:
                raise
            time.sleep(0.025)
    deadline = time.monotonic() + 12
    while time.monotonic() < deadline:
        try:
            result = json.loads((TEST / "result.json").read_text(encoding="utf-8"))
            if result.get("commandId") == request["id"]:
                if "error" in result:
                    raise RuntimeError(result["error"])
                return result
        except (FileNotFoundError, json.JSONDecodeError):
            pass
        time.sleep(0.1)
    raise TimeoutError(f"No result for {kind}")


def check(name, result, predicate):
    assert predicate(result), (name, result)
    results.append({"test": name, "passed": True, "state": result})
    print("PASS", name, flush=True)


try:
    initial = command("status")
    if not initial["ready"]:
        initial = command("start")
    check("tray initialized", initial, lambda r: r["ready"])
    check("idle native message pump stays near ten polls per second", command("measure-idle"),
          lambda r: 0 < r["native"]["pumps"] <= r["native"]["elapsedMs"] / 100 + 2
          and r["native"]["intervalMs"] == 100)
    for dark in [False, True]:
        command("appearance", appearance={"dark": dark, "taskbarDark": dark, "forcedColors": False})
        check(f"{'dark' if dark else 'light'} native menu and icon", command("inspect"),
              lambda r, dark=dark: r["native"]["iconPresent"] and r["native"]["palette"]["background"] == (0x252526 if dark else 0xffffff)
              and len(r["native"]["accessibleLabels"]) == 3 and all(r["native"]["accessibleLabels"][i] for i in [0, 2]))
    command("appearance", appearance={"dark": True, "taskbarDark": True, "forcedColors": True})
    check("Windows high contrast rendering initializes", command("inspect"), lambda r: r["native"]["iconPresent"])
    command("appearance", appearance={"dark": True, "taskbarDark": True, "forcedColors": False})
    before = command("status")["windows"][0]
    background = command("background")
    check("foreground fixture leaves the main window visible", background, lambda r: r["windows"][0]["visible"])
    check("tray click requests native activation of already visible main window", command("worker-event"),
          lambda r: r["windows"][0]["visible"] and not r["windows"][0]["hidden"]
          and r["activation"]["attempts"] > background["activation"]["attempts"]
          and (not r["activation"]["succeeded"] or r["activation"]["targetForeground"])
          and all(r["windows"][0][k] == before[k] for k in ["outerWidth", "outerHeight", "screenX", "screenY", "state"]))
    command("end-background")
    check("window.close hides without destroying", command("close"),
          lambda r: r["ready"] and r["windows"][0]["hidden"] and not r["windows"][0]["visible"])
    check("native tray selection restores", command("worker-event"), lambda r: r["windows"][0]["visible"])
    command("close")
    check("one popup after duplicate right-click notifications and Show", command("menu-click"),
          lambda r: r["native"]["popups"] == 1 and r["native"]["pendingMenus"] == 0 and r["windows"][0]["visible"])
    after = command("status")["windows"][0]
    assert (before["outerWidth"], before["outerHeight"], before["screenX"], before["screenY"]) == (
        after["outerWidth"], after["outerHeight"], after["screenX"], after["screenY"])
    check("native WM_CLOSE hides", command("native-close"), lambda r: r["windows"][0]["hidden"])
    command("show")
    check("minimize remains on taskbar", command("minimize"),
          lambda r: r["windows"][0]["state"] == 2 and not r["windows"][0]["hidden"])
    command("show")
    command("maximize")
    command("close")
    check("maximized state restored", command("worker-event"), lambda r: r["windows"][0]["state"] == 1)
    check("quit cancellation leaves process running", command("cancel-quit"), lambda r: r["ready"] and not r["quitting"])
    check("X still hides after cancelled quit", command("close"), lambda r: r["windows"][0]["hidden"])
    check("disable restores hidden window", command("stop"),
          lambda r: not r["ready"] and not r["windows"] and r["mainWindows"][0]["visible"])
    baseline = command("status")["resources"]
    for i in range(10):
        check(f"enable cycle {i+1}", command("start"), lambda r: r["ready"])
        check(f"disable cycle {i+1}", command("stop"), lambda r: not r["ready"] and not r["windows"])
    check("no per-cycle GDI/USER resource growth", command("status"),
          lambda r: r["resources"]["gdi"] <= baseline["gdi"] + 3 and r["resources"]["user"] <= baseline["user"] + 3)
    command("start")
    command("close")
    check("worker failure restores hidden window", command("fail"),
          lambda r: not r["ready"] and r["mainWindows"][0]["visible"])
    command("start")
    command("drop-icon")
    check("missing Explorer icon re-registers", command("inspect"), lambda r: r["ready"] and r["native"]["iconPresent"])
    command("close")
    check("show menu command routes to controller", command("menu-command", command=1), lambda r: r["windows"][0]["visible"])
    command("close")
    check("native worker error restores window", command("worker-failure"),
          lambda r: not r["ready"] and r["mainWindows"][0]["visible"])
    command("start")
    command("worker-event", lp=0x7b)  # Open the actual native popup, then stop while it is tracking.
    check("disable dismisses native popup and releases resources", command("stop"), lambda r: not r["ready"])
    command("start")
    command("close")
    check("delayed cleanup acknowledgement retains roots, restores window and eventually releases", command("deferred-stop"),
          lambda r: not r["deferred"]["cleaned"] and r["deferred"]["timedOut"]
          and r["deferred"]["workerRetained"] and r["deferred"]["rooted"]
          and r["deferred"]["releasedAfterAck"] and r["mainWindows"][0]["visible"])
    command("start")
    command("restore")
finally:
    (ROOT / "artifacts" / "integration-results.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
