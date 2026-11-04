"""Create an isolated profile with an unpacked harness; never touch real profiles.

After starting Zotero with the printed arguments, write one JSON command to
artifacts/test-profile/command.json. Results appear in result.json.
The command bridge exists only in this test harness, NOT in the shipped XPI.
"""
import json
from pathlib import Path
import shutil
import argparse
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--install", action="store_true", help="Install the harness XPI before starting the isolated profile")
args = parser.parse_args()

ROOT = Path(__file__).resolve().parents[1]
TEST = ROOT / "artifacts" / "test-profile"
PROFILE = TEST / "profile"
HARNESS = TEST / "harness"
DATA = TEST / "data"

for directory in [PROFILE / "extensions", HARNESS, DATA]:
    directory.mkdir(parents=True, exist_ok=True)
for name in ["command.json", "result.json", "shutdown.json"]:
    stale = TEST / name
    if stale.is_file():
        stale.unlink()
manifest = json.loads((ROOT / "addon" / "manifest.json").read_text(encoding="utf-8"))
(HARNESS / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
proxy = PROFILE / "extensions" / manifest["applications"]["zotero"]["id"]
if proxy.with_name(proxy.name + ".xpi").exists():
    if proxy.is_file():
        proxy.unlink()
else:
    proxy.write_text(str(HARNESS), encoding="utf-8")
prefs = {
    "extensions.autoDisableScopes": 0,
    "extensions.enabledScopes": 15,
    "extensions.startupScanScopes": 15,
    "extensions.zotero.useDataDir": True,
    "extensions.zotero.dataDir": str(DATA),
    "extensions.zotero.firstRun": False,
    "extensions.zotero.firstRun2": False,
    "extensions.zotero.automaticScraperUpdates": False,
    "extensions.zotero.repository.lastCheck": 2147483647,
    "extensions.zotero.httpServer.port": 23129,
    "extensions.zotero.debug.log": True,
    "extensions.zotero.debug.level": 5,
    "app.update.auto": False,
    "app.update.enabled": False,
    "browser.shell.checkDefaultBrowser": False,
    "toolkit.telemetry.reportingpolicy.firstRun": False,
    "datareporting.policy.dataSubmissionEnabled": False,
    "marionette.port": 2829,
}
(PROFILE / "user.js").write_text("\n".join(f"user_pref({json.dumps(k)}, {json.dumps(v)});" for k, v in prefs.items()) + "\n", encoding="utf-8")
template = r'''
const sourceRoot = __SOURCE__;
const testDir = __TEST__;
Services.scriptloader.loadSubScript(sourceRoot + "bootstrap.js", globalThis);
const actualStartup = startup;
const actualShutdown = shutdown;
var testTimer;
var lastCommand = null;
var activation = { attempts: 0 };
function trackActivation() {
  const bridge = ZoteroTray.nativeBridge;
  if (!bridge || bridge.testTracked) return;
  const foreground = bridge.foreground;
  const getForeground = bridge.user32.declare("GetForegroundWindow", bridge.c.winapi_abi, bridge.c.voidptr_t);
  const address = handle => bridge.c.cast(handle, bridge.c.uintptr_t).value.toString();
  bridge.foreground = handle => {
    const result = foreground(handle);
    activation = { attempts: activation.attempts + 1, succeeded: !!result, target: handle.toString(),
      targetForeground: address(handle) === address(getForeground()) };
    return result;
  };
  bridge.testTracked = true;
}
async function status(extra = {}) {
  const { ctypes: c } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
  const user = c.open(Services.dirsvc.get("SysD", Components.interfaces.nsIFile).path + "\\user32.dll");
  const isVisible = user.declare("IsWindowVisible", c.winapi_abi, c.int32_t, c.voidptr_t);
  const getForeground = user.declare("GetForegroundWindow", c.winapi_abi, c.voidptr_t);
  const foregroundHandle = c.cast(getForeground(), c.uintptr_t).value.toString();
  const guiResources = user.declare("GetGuiResources", c.winapi_abi, c.uint32_t, c.voidptr_t, c.uint32_t);
  const kernel = c.open(Services.dirsvc.get("SysD", Components.interfaces.nsIFile).path + "\\kernel32.dll");
  const currentProcess = kernel.declare("GetCurrentProcess", c.winapi_abi, c.voidptr_t)();
  const visible = win => isVisible(c.cast(c.uintptr_t(c.UInt64(ZoteroTray.baseWindow(win).nativeHandle)), c.voidptr_t)) !== 0;
  const wins = [...ZoteroTray.windows].map(([win, state]) => ({
    hidden: state.hidden, visible: visible(win), baseVisible: ZoteroTray.baseWindow(win).visibility,
    foreground: c.cast(ZoteroTray.windowHandle(win), c.uintptr_t).value.toString() === foregroundHandle,
    state: win.windowState, nativeHandle: ZoteroTray.baseWindow(win).nativeHandle,
    outerWidth: win.outerWidth, outerHeight: win.outerHeight,
    screenX: win.screenX, screenY: win.screenY
  }));
  await IOUtils.writeJSON(PathUtils.join(testDir, "result.json"), {
    ready: ZoteroTray.ready, stopping: ZoteroTray.stopping, quitting: ZoteroTray.quitting,
    nativeHwnd: ZoteroTray.nativeBridge?.hwnd?.toString(), windows: wins,
    mainWindows: Zotero.getMainWindows().map(win => ({ visible: visible(win), state: win.windowState })),
    resources: { gdi: guiResources(currentProcess, 0), user: guiResources(currentProcess, 1) },
    startupTiming: ZoteroTray.startupTiming,
    activation,
    ...extra
  });
  user.close();
  kernel.close();
}
startup = async function(data, reason) {
  await actualStartup(data, reason);
  testTimer = setInterval(async () => {
    try {
      const file = PathUtils.join(testDir, "command.json");
      if (!await IOUtils.exists(file)) return;
      const command = await IOUtils.readJSON(file);
      if (command.id === lastCommand) return;
      lastCommand = command.id;
      const win = Zotero.getMainWindow();
      let details = {};
      trackActivation();
      switch (command.type) {
        case "close": win.close(); break;
        case "show": ZoteroTray.showAll(); break;
        case "minimize": win.minimize(); break;
        case "maximize": win.maximize(); break;
        case "restore": win.restore(); break;
        case "stop": await ZoteroTray.stop(); break;
        case "start": await ZoteroTray.start(data); break;
        case "fail": ZoteroTray.fail(new Error("Injected worker failure")); break;
        case "quit": ZoteroTray.quit(); break;
        case "worker-failure": ZoteroTray.worker.postMessage({ type: "test-fail" }); break;
        case "drop-icon": ZoteroTray.worker.postMessage({ type: "test-drop-icon" }); break;
        case "menu-command": ZoteroTray.worker.postMessage({ type: "test-menu", command: command.command }); break;
        case "appearance": ZoteroTray.worker.postMessage({ type: "appearance", ...command.appearance }); break;
        case "inspect":
        case "measure-idle":
        case "background":
        case "menu-click": {
          const worker = ZoteroTray.worker;
          const original = worker.onmessage;
          try {
            details.native = await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => reject(new Error("Worker inspection timed out")), 3000);
              worker.onmessage = event => {
                original(event);
                if (event.data.type === "test-state") { clearTimeout(timeout); resolve(event.data); }
              };
              worker.postMessage({ type: command.type === "menu-click" ? "test-menu-click"
                : (command.type === "background" ? "test-background"
                  : (command.type === "measure-idle" ? "test-measure-idle" : "test-inspect")), request: command.id });
            });
          } finally { worker.onmessage = original; }
          break;
        }
        case "cancel-quit": {
          const cancel = { observe(subject) {
            subject.QueryInterface(Components.interfaces.nsISupportsPRBool).data = true;
          }};
          Services.obs.addObserver(cancel, "quit-application-requested");
          try { ZoteroTray.quit(); }
          finally { Services.obs.removeObserver(cancel, "quit-application-requested"); }
          break;
        }
        case "worker-event": {
          // Exercise the real native WNDPROC + message pump using PostMessage.
          const b = ZoteroTray.nativeBridge;
          b.post(b.hwnd, command.message || 0x8001, command.wp || 0, command.lp || 0x400);
          break;
        }
        case "native-close": {
          const b = ZoteroTray.nativeBridge;
          const handle = b.c.cast(b.c.uintptr_t(b.c.UInt64(ZoteroTray.baseWindow(win).nativeHandle)), b.c.voidptr_t);
          b.post(handle, 0x10, 0, 0);
          break;
        }
        case "end-background": ZoteroTray.worker.postMessage({ type: "test-hide-fixture" }); break;
        case "deferred-stop": {
          const worker = ZoteroTray.worker;
          const original = worker.onmessage;
          let acknowledgement;
          worker.onmessage = event => {
            if (event.data.type === "stopped") acknowledgement = event;
            else original(event);
          };
          const timeout = ZoteroTray.stopTimeoutMs;
          try {
            ZoteroTray.stopTimeoutMs = 50;
            const cleaned = await ZoteroTray.stop();
            details.deferred = { cleaned, timedOut: ZoteroTray.stopTimedOut,
              workerRetained: ZoteroTray.worker === worker,
              rooted: Zotero.__zoteroTrayPendingCleanup?.has(ZoteroTray) === true };
            const deadline = Date.now() + 2000;
            while (!acknowledgement && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
            if (!acknowledgement) throw new Error("No delayed cleanup acknowledgement");
            original(acknowledgement);
            details.deferred.releasedAfterAck = !ZoteroTray.worker && !Zotero.__zoteroTrayPendingCleanup;
          } finally { ZoteroTray.stopTimeoutMs = timeout; }
          break;
        }
        case "retry-stop": {
          const worker = ZoteroTray.worker, original = worker.onmessage;
          let attempts = 0;
          try {
            await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => reject(new Error("Cleanup fixture timed out")), 3000);
              worker.onmessage = event => {
                if (event.data.type === "test-cleanup-attempt") attempts = event.data.attempt;
                else if (event.data.type === "test-cleanup-ready") { clearTimeout(timeout); resolve(); }
                else original(event);
              };
              worker.postMessage({ type: "test-cleanup-retry" });
            });
            details.retryStop = { cleaned: await ZoteroTray.stop(), attempts };
          } finally {
            if (ZoteroTray.worker === worker) worker.onmessage = original;
          }
          break;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 250));
      await status({ commandId: command.id, ...details });
    } catch (error) {
      await IOUtils.writeJSON(PathUtils.join(testDir, "result.json"), {
        commandId: lastCommand, error: String(error.stack || error)
      });
    }
  }, 200);
};
shutdown = async function() {
  clearInterval(testTimer);
  await actualShutdown();
  await IOUtils.writeJSON(PathUtils.join(testDir, "shutdown.json"), { cleaned: !ZoteroTray.worker });
};
'''
template = template.replace("__SOURCE__", json.dumps((ROOT / "addon").as_uri() + "/"))
template = template.replace("__TEST__", json.dumps(str(TEST)))
(HARNESS / "bootstrap.js").write_text(template, encoding="utf-8")
(HARNESS / "content").mkdir(exist_ok=True)
worker = (ROOT / "addon" / "content" / "tray-worker.js").read_text(encoding="utf-8")
worker += r'''
// TEST HARNESS ONLY: these messages are absent from the production package.
let measuredPumps = 0;
const productionPump = tray.pump.bind(tray);
tray.pump = () => { measuredPumps++; return productionPump(); };
let instrumentedAPI;
const resourceCreates = { brushes: 0, fonts: 0, icons: 0 };
const productionAppearance = tray.applyAppearance.bind(tray);
tray.applyAppearance = config => {
  if (instrumentedAPI !== tray.api) {
    for (const [name, key] of [["CreateSolidBrush", "brushes"], ["CreateFontW", "fonts"], ["CreateIconFromResourceEx", "icons"]]) {
      const original = tray.api[name];
      tray.api[name] = (...args) => { resourceCreates[key]++; return original(...args); };
    }
    instrumentedAPI = tray.api;
  }
  return productionAppearance(config);
};
const productionOnMessage = onmessage;
onmessage = function(event) {
  if (event.data.type === "test-fail") tray.fail(new Error("Injected native worker failure"));
  else if (event.data.type === "test-cleanup-retry") {
    const destroy = tray.api.DestroyWindow;
    let first = true;
    tray.api.DestroyWindow = hwnd => {
      postMessage({ type: "test-cleanup-attempt", attempt: tray.cleanupAttempts });
      if (first) { first = false; return 0; }
      return destroy(hwnd);
    };
    postMessage({ type: "test-cleanup-ready" });
  }
  else if (event.data.type === "test-measure-idle") {
    const before = measuredPumps, started = Date.now();
    setTimeout(() => postMessage({ type: "test-state", pumps: measuredPumps - before,
      elapsedMs: Date.now() - started, intervalMs: tray.pumpIntervalMs }), 2100);
  }
  else if (event.data.type === "test-background" || event.data.type === "test-hide-fixture") {
    const showWindow = tray.libs[0].declare("ShowWindow", ctypes.winapi_abi, ctypes.int32_t, ctypes.voidptr_t, ctypes.int32_t);
    showWindow(tray.hwnd, event.data.type === "test-background" ? 5 : 0);
    if (event.data.type === "test-background") {
      const activated = tray.api.SetForegroundWindow(tray.hwnd);
      postMessage({ type: "test-state", fixtureActivated: !!activated });
    }
  }
  else if (event.data.type === "test-menu-click") {
    const original = tray.api.TrackPopupMenu;
    let popups = 0;
    tray.api.TrackPopupMenu = () => {
      popups++;
      // Selection-time notifications must not leave another pending popup.
      tray.windowProc(tray.hwnd, tray.callbackMessage, 0, 0x205);
      tray.windowProc(tray.hwnd, tray.callbackMessage, 0, 0x7b);
      return 1;
    };
    for (const notification of [0x205, 0x7b, 0x7b]) {
      tray.api.PostMessageW(tray.hwnd, tray.callbackMessage, 0, notification);
    }
    setTimeout(() => {
      tray.api.TrackPopupMenu = original;
      postMessage({ type: "test-state", popups,
        pendingMenus: tray.pending.filter(e => e.type === "menu").length });
    }, 180);
  }
  else if (event.data.type === "test-inspect") {
    postMessage({ type: "test-state", request: event.data.request,
      iconPresent: !!tray.api.Shell_NotifyIconW(1, tray.nid.address()),
      palette: tray.palette, dpi: tray.dpi, resourceCreates,
      accessibleLabels: tray.accessibleItems.map(i => i.text.readString()) });
  }
  else if (event.data.type === "test-drop-icon") {
    tray.api.Shell_NotifyIconW(2, tray.nid.address());
    tray.added = false;
    tray.lastCheck = 0;
  } else if (event.data.type === "test-menu") {
    const original = tray.api.TrackPopupMenu;
    tray.api.TrackPopupMenu = () => event.data.command;
    try { tray.showMenu(); } finally { tray.api.TrackPopupMenu = original; }
  } else productionOnMessage(event);
};
'''
(HARNESS / "content" / "tray-worker.js").write_text(worker, encoding="utf-8")
shutil.copyfile(ROOT / "addon" / "content" / "appearance.js", HARNESS / "content" / "appearance.js")
if args.install:
    package = TEST / "harness.xpi"
    with zipfile.ZipFile(package, "w") as archive:
        for file in sorted(HARNESS.rglob("*")):
            if file.is_file():
                archive.write(file, file.relative_to(HARNESS).as_posix())
    shutil.copyfile(package, proxy.with_name(proxy.name + ".xpi"))
    if proxy.is_file():
        proxy.unlink()
print(f'"C:\\Program Files\\Zotero\\zotero.exe" -no-remote -profile "{PROFILE}" -ZoteroDebugText')
