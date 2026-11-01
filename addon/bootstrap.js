/* SPDX-License-Identifier: MIT */
"use strict";

// This controller lives only in Zotero's privileged plugin sandbox.
var ZoteroTray = {
  worker: null,
  windows: new Map(),
  ready: false,
  stopping: false,
  quitting: false,
  requestingQuit: false,
  sessionEnding: false,
  observers: [],
  readyTimer: null,
  stopPromise: null,
  resolveStop: null,
  chromeHandle: null,
  nativeBridge: null,
  lastAppearanceKey: null,
  startupTiming: null,

  appearance() {
    const win = [...this.windows.keys()].find(win => !win.closed) || Zotero.getMainWindow();
    const dark = win?.matchMedia?.("(prefers-color-scheme: dark)").matches || false;
    const forcedColors = win?.matchMedia?.("(forced-colors: active)").matches || false;
    let taskbarDark = dark;
    let key;
    try {
      key = Components.classes["@mozilla.org/windows-registry-key;1"]
        .createInstance(Components.interfaces.nsIWindowsRegKey);
      key.open(key.ROOT_KEY_CURRENT_USER, "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", key.ACCESS_READ);
      if (key.hasValue("SystemUsesLightTheme")) taskbarDark = key.readIntValue("SystemUsesLightTheme") === 0;
    } catch (_) {
      // Windows may omit the personalization key; use Zotero's color scheme.
    } finally { try { key?.close(); } catch (_) {} }
    return { dark, taskbarDark, forcedColors };
  },

  updateAppearance(force = false) {
    if (!this.worker || this.stopping) return;
    const appearance = this.appearance();
    const key = JSON.stringify(appearance);
    if (!force && key === this.lastAppearanceKey) return;
    this.lastAppearanceKey = key;
    this.worker.postMessage({ type: "appearance", ...appearance });
  },

  log(message) {
    Zotero.debug(`[Zotero Tray] ${message}`);
  },

  async start(data) {
    if (!Zotero.isWin || this.worker) return;
    this.startupTiming = { enteredAt: Date.now() };
    this.log("Starting tray initialization");
    this.stopping = false;
    this.quitting = false;
    this.requestingQuit = false;
    this.sessionEnding = false;
    this.ready = false;
    this.stopPromise = null;
    this.lastAppearanceKey = null;
    try {
      // Registering a chrome URL also supports workers loaded from a packed XPI.
      const aom = Components.classes["@mozilla.org/addons/addon-manager-startup;1"]
        .getService(Components.interfaces.amIAddonManagerStartup);
      this.chromeHandle = aom.registerChrome(Services.io.newURI(data.rootURI + "manifest.json"), [
        ["content", "zotero-tray", "content/"]
      ]);
      this.observe("quit-application-requested", () => {
        this.requestingQuit = true;
        // Normal quit's CanClose checks can precede quit-application-granted.
        // Expire this synchronous bypass if any observer cancels the attempt.
        setTimeout(() => { this.requestingQuit = false; }, 0);
      });
      this.observe("quit-application-granted", () => { this.quitting = true; });
      this.observe("quit-application", () => { this.quitting = true; });
      this.worker = new ChromeWorker("chrome://zotero-tray/content/tray-worker.js");
      this.worker.onmessage = event => this.onMessage(event.data);
      this.worker.onerror = event => {
        event.preventDefault();
        this.fail(new Error(`${event.message} (${event.filename}:${event.lineno})`));
      };
      this.readyTimer = setTimeout(() => this.fail(new Error("Tray initialization timed out")), 10000);
      const system = Services.dirsvc.get("SysD", Components.interfaces.nsIFile).path;
      const appearance = this.appearance();
      this.lastAppearanceKey = JSON.stringify(appearance);
      // Let the worker initialize while the main thread loads its small
      // shutdown bridge; native initialization can run off the main thread.
      this.worker.postMessage({
        type: "init", system, ...appearance,
        labels: Services.locale.appLocaleAsBCP47.startsWith("zh")
          ? { show: "显示 Zotero", quit: "退出 Zotero" }
          : { show: "Show Zotero", quit: "Quit Zotero" }
      });
      const { ctypes: c } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
      const user32 = c.open(system + "\\user32.dll");
      this.nativeBridge = {
        c, user32,
        post: user32.declare("PostMessageW", c.winapi_abi, c.int32_t,
          c.voidptr_t, c.uint32_t, c.uintptr_t, c.intptr_t),
        isVisible: user32.declare("IsWindowVisible", c.winapi_abi, c.int32_t, c.voidptr_t),
        foreground: user32.declare("SetForegroundWindow", c.winapi_abi, c.int32_t, c.voidptr_t),
        hwnd: null
      };
      for (const win of Zotero.getMainWindows()) this.attach(win);
    } catch (error) {
      this.fail(error);
    }
  },

  observe(topic, handler) {
    const observer = { observe: handler };
    Services.obs.addObserver(observer, topic);
    this.observers.push([topic, observer]);
  },

  onMessage(message) {
    if (message.type === "stopped") {
      this.log("Native resources released");
      this.resolveStop?.();
      return;
    }
    if (this.stopping) return;
    switch (message.type) {
      case "ready":
        clearTimeout(this.readyTimer);
        this.nativeBridge.hwnd = this.nativeBridge.c.cast(
          this.nativeBridge.c.uintptr_t(this.nativeBridge.c.UInt64(message.hwnd)),
          this.nativeBridge.c.voidptr_t);
        this.ready = true;
        this.startupTiming = {
          ...this.startupTiming,
          iconReadyMs: message.readyAt - this.startupTiming.enteredAt,
          workerInitMs: message.workerInitMs,
          mainReadyMs: Date.now() - this.startupTiming.enteredAt,
          notificationDelayMs: Date.now() - message.readyAt
        };
        this.log(`Tray ready (${message.pointerBits}-bit; icon ${this.startupTiming.iconReadyMs} ms; `
          + `worker ${message.workerInitMs} ms; notification delay ${this.startupTiming.notificationDelayMs} ms)`);
        break;
      case "show": this.showAll(); break;
      case "appearance-request": this.updateAppearance(true); break;
      case "quit": this.quit(); break;
      case "session-ending": this.sessionEnding = message.ending; break;
      case "error": this.fail(new Error(message.message)); break;
      case "log": this.log(message.message); break;
    }
  },

  baseWindow(win) {
    return win.docShell.treeOwner.QueryInterface(Components.interfaces.nsIInterfaceRequestor)
      .getInterface(Components.interfaces.nsIBaseWindow);
  },

  windowHandle(win) {
    const { c } = this.nativeBridge;
    return c.cast(c.uintptr_t(c.UInt64(this.baseWindow(win).nativeHandle)), c.voidptr_t);
  },

  attach(win) {
    if (this.stopping || !win || this.windows.has(win)
      || win.location.href !== "chrome://zotero/content/zoteroPane.xhtml") return;
    const state = { hidden: false, maximized: false };
    state.close = event => {
      // Content browsers can bubble their own close events through this window.
      if (event.target !== win && event.target !== win.document) return;
      if (!this.ready || this.stopping || this.quitting || this.requestingQuit || this.sessionEnding || event.defaultPrevented) return;
      try {
        if (!state.hidden) state.maximized = win.windowState === win.STATE_MAXIMIZED;
        this.baseWindow(win).visibility = false;
        state.hidden = true;
        event.preventDefault();
        event.stopImmediatePropagation();
        this.log("Main window hidden");
      } catch (error) {
        this.fail(error);
      }
    };
    win.addEventListener("close", state.close, true);
    win.addEventListener("DOMWindowClose", state.close, true);
    state.themeQueries = ["(prefers-color-scheme: dark)", "(forced-colors: active)"]
      .map(query => win.matchMedia?.(query)).filter(Boolean);
    state.themeChanged = () => this.updateAppearance();
    for (const query of state.themeQueries) query.addEventListener("change", state.themeChanged);
    this.windows.set(win, state);
    this.updateAppearance();
  },

  detach(win) {
    const state = this.windows.get(win);
    if (!state) return;
    win.removeEventListener("close", state.close, true);
    win.removeEventListener("DOMWindowClose", state.close, true);
    for (const query of state.themeQueries) query.removeEventListener("change", state.themeChanged);
    this.windows.delete(win);
  },

  showAll() {
    for (const [win, state] of this.windows) {
      if (win.closed) continue;
      try {
        const bridge = this.nativeBridge;
        const handle = bridge ? this.windowHandle(win) : null;
        const hidden = bridge ? !bridge.isVisible(handle) : state.hidden;
        // A visible window needs activation only; reapplying visibility can
        // disturb its state. Gecko focus alone may leave it behind other apps.
        if (hidden) this.baseWindow(win).visibility = true;
        if (win.windowState === win.STATE_MINIMIZED) win.restore();
        if (hidden && state.maximized) win.maximize();
        state.hidden = false;
        win.focus();
        if (bridge && !bridge.foreground(handle)) {
          this.log("Windows declined foreground activation");
        }
      } catch (error) {
        Zotero.logError(error);
      }
    }
  },

  quit() {
    this.showAll();
    const win = [...this.windows.keys()].find(win => !win.closed);
    if (!win) return;
    // Use the same cancellation notification and attempt-quit path as File > Exit.
    // Set bypass only on quit-application-granted: a cancelled attempt must not
    // permanently turn a later click on X into an application exit.
    win.goQuitApplication({ ctrlKey: false, metaKey: false });
  },

  fail(error) {
    this.ready = false;
    this.log(`Tray unavailable: ${error.message}`);
    Zotero.logError(error);
    // stop() restores every hidden main window before removing the tray.
    this.stop().catch(error => Zotero.logError(error));
  },

  async stop() {
    if (this.stopPromise) return this.stopPromise;
    this.stopping = true;
    this.ready = false;
    clearTimeout(this.readyTimer);
    if (!this.quitting && !this.sessionEnding) this.showAll();
    for (const win of [...this.windows.keys()]) this.detach(win);
    for (const [topic, observer] of this.observers) Services.obs.removeObserver(observer, topic);
    this.observers = [];
    const worker = this.worker;
    this.stopPromise = (async () => {
      if (worker) {
        // Cooperative shutdown is essential: terminating a worker with a live
        // native WNDPROC would leave a dangling function pointer inside Windows.
        await new Promise(resolve => {
          this.resolveStop = resolve;
          // The worker can be inside TrackPopupMenu's native modal loop. A
          // posted window message breaks that loop even while JS messages wait.
          if (this.nativeBridge?.hwnd) {
            this.nativeBridge.post(this.nativeBridge.hwnd, 0x8002, 0, 0);
          }
          worker.postMessage({ type: "stop" });
        });
        worker.onmessage = null;
        worker.onerror = null;
        worker.terminate();
      }
      this.worker = null;
      this.resolveStop = null;
      this.nativeBridge?.user32.close();
      this.nativeBridge = null;
      this.chromeHandle?.destruct();
      this.chromeHandle = null;
    })();
    return this.stopPromise;
  }
};

function install() {}
function uninstall() {}
async function startup(data) { await ZoteroTray.start(data); }
async function shutdown() { await ZoteroTray.stop(); }
function onMainWindowLoad({ window }) { ZoteroTray.attach(window); }
function onMainWindowUnload({ window }) { ZoteroTray.detach(window); }
