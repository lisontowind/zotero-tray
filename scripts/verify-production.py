"""Use a separate test-only verifier to smoke-test the production XPI and quit."""
import json
from pathlib import Path
import time
import zipfile
from marionette import Client

ROOT = Path(__file__).resolve().parents[1]
TEST = ROOT / "artifacts" / "test-profile"
manifest = json.loads((ROOT / "addon" / "manifest.json").read_text(encoding="utf-8"))
report = ROOT / "artifacts" / f"production-{manifest['version']}-result.json"
if report.exists():
    report.unlink()
source = r'''
function install() {}
function uninstall() {}
function shutdown() {}
function startup() {
  setTimeout(async () => {
    let user, kernel;
    try {
      await Zotero.initializationPromise;
      const profile = Services.dirsvc.get("ProfD", Components.interfaces.nsIFile).path;
      if (profile.toLowerCase() !== __PROFILE__.toLowerCase()) throw new Error("Unexpected Zotero profile: " + profile);
      const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
      const addon = await AddonManager.getAddonByID("zotero-tray@local");
      const { ctypes: c } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
      const system = Services.dirsvc.get("SysD", Components.interfaces.nsIFile).path;
      user = c.open(system + "\\user32.dll");
      kernel = c.open(system + "\\kernel32.dll");
      const ownPid = kernel.declare("GetCurrentProcessId", c.winapi_abi, c.uint32_t)();
      const find = user.declare("FindWindowExW", c.winapi_abi, c.voidptr_t, c.voidptr_t, c.voidptr_t, c.char16_t.ptr, c.char16_t.ptr);
      const owner = user.declare("GetWindowThreadProcessId", c.winapi_abi, c.uint32_t, c.voidptr_t, c.uint32_t.ptr);
      const post = user.declare("PostMessageW", c.winapi_abi, c.int32_t, c.voidptr_t, c.uint32_t, c.uintptr_t, c.intptr_t);
      const visible = user.declare("IsWindowVisible", c.winapi_abi, c.int32_t, c.voidptr_t);
      let tray = c.voidptr_t();
      const pid = c.uint32_t();
      do {
        tray = find(null, tray, null, "Zotero Tray");
        if (tray.isNull()) break;
        owner(tray, pid.address());
      } while (pid.value !== ownPid);
      if (tray.isNull()) throw new Error("Production tray window not found");
      const win = Zotero.getMainWindow();
      const base = win.docShell.treeOwner.QueryInterface(Components.interfaces.nsIInterfaceRequestor)
        .getInterface(Components.interfaces.nsIBaseWindow);
      const hwnd = c.cast(c.uintptr_t(c.UInt64(base.nativeHandle)), c.voidptr_t);
      win.close();
      await new Promise(r => setTimeout(r, 250));
      const hidden = !win.closed && !visible(hwnd);
      post(tray, 0x8001, 0, 0x400);
      await new Promise(r => setTimeout(r, 300));
      await IOUtils.writeJSON(__REPORT__, { version: addon.version, active: addon.isActive,
        author: addon.creator?.name, homepage: addon.homepageURL, icon: addon.iconURL,
        hidden, restored: !!visible(hwnd), profile, processId: ownPid });
      setTimeout(() => win.goQuitApplication({ ctrlKey: false, metaKey: false }), 500);
    } catch (error) {
      await IOUtils.writeJSON(__REPORT__, { error: String(error.stack || error) });
    } finally { user?.close(); kernel?.close(); }
  }, 500);
}
'''
source = source.replace("__PROFILE__", json.dumps(str(TEST / "profile"))).replace("__REPORT__", json.dumps(str(report)))
verifier = dict(manifest)
verifier["name"] = "Zotero Tray production verifier (test only)"
verifier["applications"] = {"zotero": dict(manifest["applications"]["zotero"], id="zotero-tray-verifier@local")}
verifier.pop("icons", None)
package = TEST / "production-verifier.xpi"
with zipfile.ZipFile(package, "w") as archive:
    archive.writestr("manifest.json", json.dumps(verifier))
    archive.writestr("bootstrap.js", source)
client = Client()
try:
    client.call("Addon:Install", {"path": str(package), "temporary": True})
finally:
    client.close()
deadline = time.monotonic() + 15
while not report.exists():
    if time.monotonic() >= deadline:
        raise TimeoutError("Production verifier did not report")
    time.sleep(0.1)
result = json.loads(report.read_text(encoding="utf-8"))
assert "error" not in result, result
assert result["version"] == manifest["version"] and result["active"], result
assert result["author"] == manifest["author"], result
assert result["homepage"] == manifest["homepage_url"], result
assert result["icon"] and result["icon"].endswith("icons/icon.svg"), result
assert result["hidden"] and result["restored"], result
print(json.dumps(result, ensure_ascii=False, indent=2))
