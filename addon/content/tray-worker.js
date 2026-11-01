/* SPDX-License-Identifier: MIT */
"use strict";
importScripts("appearance.js");

// ChromeWorker provides ctypes. All HWNDs, native callbacks and their message
// pump belong to this one thread. No DLL/EXE is bundled or downloaded.
var tray = {
  libs: [], api: {}, types: {}, hwnd: null, icon: null, menu: null,
  callback: null, className: null, instance: null, nid: null,
  timer: null, stopping: false, registered: false, added: false,
  pending: [], inMenu: false, lastCheck: 0, recoveryFailures: 0,
  callbackMessage: 0x8001, stopMessage: 0x8002,
  brushes: {}, font: null, palette: null, appearanceKey: null,
  accessibleItems: [], retiredBrushes: [],

  init(config) {
    const initStarted = Date.now();
    const c = ctypes;
    const t = this.types;
    t.HANDLE = c.voidptr_t;
    t.UINT = c.uint32_t;
    t.DWORD = c.uint32_t;
    t.BOOL = c.int32_t; // Windows BOOL is four bytes, not ctypes.bool.
    t.LONG = c.int32_t;
    t.WCHAR = c.char16_t;
    t.WPARAM = c.uintptr_t;
    t.LPARAM = c.intptr_t;
    t.LRESULT = c.intptr_t;
    t.POINT = c.StructType("POINT", [{ x: t.LONG }, { y: t.LONG }]);
    t.RECT = c.StructType("RECT", [{ left: t.LONG }, { top: t.LONG }, { right: t.LONG }, { bottom: t.LONG }]);
    t.MEASUREITEM = c.StructType("MEASUREITEMSTRUCT", [
      { CtlType: t.UINT }, { CtlID: t.UINT }, { itemID: t.UINT },
      { itemWidth: t.UINT }, { itemHeight: t.UINT }, { itemData: c.uintptr_t }
    ]);
    t.DRAWITEM = c.StructType("DRAWITEMSTRUCT", [
      { CtlType: t.UINT }, { CtlID: t.UINT }, { itemID: t.UINT },
      { itemAction: t.UINT }, { itemState: t.UINT }, { hwndItem: t.HANDLE },
      { hDC: t.HANDLE }, { rcItem: t.RECT }, { itemData: c.uintptr_t }
    ]);
    t.MENUINFO = c.StructType("MENUINFO", [
      { cbSize: t.DWORD }, { fMask: t.DWORD }, { dwStyle: t.DWORD }, { cyMax: t.UINT },
      { hbrBack: t.HANDLE }, { dwContextHelpID: t.DWORD }, { dwMenuData: c.uintptr_t }
    ]);
    t.MENUITEMINFO = c.StructType("MENUITEMINFOW", [
      { cbSize: t.UINT }, { fMask: t.UINT }, { fType: t.UINT }, { fState: t.UINT }, { wID: t.UINT },
      { hSubMenu: t.HANDLE }, { hbmpChecked: t.HANDLE }, { hbmpUnchecked: t.HANDLE },
      { dwItemData: c.uintptr_t }, { dwTypeData: t.WCHAR.ptr }, { cch: t.UINT }, { hbmpItem: t.HANDLE }
    ]);
    t.MSAAMENUINFO = c.StructType("MSAAMENUINFO", [
      { dwMSAASignature: t.DWORD }, { cchWText: t.DWORD }, { pszWText: t.WCHAR.ptr }
    ]);
    t.MSG = c.StructType("MSG", [
      { hwnd: t.HANDLE }, { message: t.UINT }, { wParam: t.WPARAM },
      { lParam: t.LPARAM }, { time: t.DWORD }, { pt: t.POINT }, { lPrivate: t.DWORD }
    ]);
    const callbackABI = t.HANDLE.size === 8 ? c.default_abi : c.stdcall_abi;
    t.WNDPROC = c.FunctionType(callbackABI, t.LRESULT,
      [t.HANDLE, t.UINT, t.WPARAM, t.LPARAM]).ptr;
    t.WNDCLASSEX = c.StructType("WNDCLASSEXW", [
      { cbSize: t.UINT }, { style: t.UINT }, { lpfnWndProc: t.WNDPROC },
      { cbClsExtra: c.int32_t }, { cbWndExtra: c.int32_t }, { hInstance: t.HANDLE },
      { hIcon: t.HANDLE }, { hCursor: t.HANDLE }, { hbrBackground: t.HANDLE },
      { lpszMenuName: t.WCHAR.ptr }, { lpszClassName: t.WCHAR.ptr }, { hIconSm: t.HANDLE }
    ]);
    t.GUID = c.StructType("GUID", [
      { Data1: t.DWORD }, { Data2: c.uint16_t }, { Data3: c.uint16_t },
      { Data4: c.uint8_t.array(8) }
    ]);
    t.NID = c.StructType("NOTIFYICONDATAW", [
      { cbSize: t.DWORD }, { hWnd: t.HANDLE }, { uID: t.UINT }, { uFlags: t.UINT },
      { uCallbackMessage: t.UINT }, { hIcon: t.HANDLE }, { szTip: t.WCHAR.array(128) },
      { dwState: t.DWORD }, { dwStateMask: t.DWORD }, { szInfo: t.WCHAR.array(256) },
      { uVersion: t.UINT }, { szInfoTitle: t.WCHAR.array(64) }, { dwInfoFlags: t.DWORD },
      { guidItem: t.GUID }, { hBalloonIcon: t.HANDLE }
    ]);
    const expected = t.HANDLE.size === 8 ? [48, 80, 976] : [32, 48, 956];
    const actual = [t.MSG.size, t.WNDCLASSEX.size, t.NID.size];
    if (![4, 8].includes(t.HANDLE.size) || actual.some((v, i) => v !== expected[i])) {
      throw new Error(`Unsupported Win32 layouts: ${actual.join(",")}`);
    }
    const drawExpected = t.HANDLE.size === 8 ? [32, 64, 40] : [24, 48, 28];
    if ([t.MEASUREITEM.size, t.DRAWITEM.size, t.MENUINFO.size].some((v, i) => v !== drawExpected[i])) {
      throw new Error("Unsupported native menu structure layouts");
    }
    const open = name => {
      // Absolute system directory supplied by Zotero, never DLL search in cwd.
      const lib = c.open(config.system + "\\" + name);
      this.libs.push(lib);
      return lib;
    };
    const user = open("user32.dll"), shell = open("shell32.dll"), kernel = open("kernel32.dll"), gdi = open("gdi32.dll");
    const declare = (lib, name, result, ...args) => {
      this.api[name] = lib.declare(name, c.winapi_abi, result, ...args);
    };
    declare(kernel, "GetModuleHandleW", t.HANDLE, t.WCHAR.ptr);
    declare(kernel, "GetLastError", t.DWORD);
    declare(kernel, "GetCurrentThreadId", t.DWORD);
    declare(user, "RegisterClassExW", c.uint16_t, t.WNDCLASSEX.ptr);
    declare(user, "UnregisterClassW", t.BOOL, t.WCHAR.ptr, t.HANDLE);
    declare(user, "CreateWindowExW", t.HANDLE, t.DWORD, t.WCHAR.ptr, t.WCHAR.ptr,
      t.DWORD, c.int32_t, c.int32_t, c.int32_t, c.int32_t,
      t.HANDLE, t.HANDLE, t.HANDLE, c.voidptr_t);
    declare(user, "DestroyWindow", t.BOOL, t.HANDLE);
    declare(user, "DefWindowProcW", t.LRESULT, t.HANDLE, t.UINT, t.WPARAM, t.LPARAM);
    declare(user, "PeekMessageW", t.BOOL, t.MSG.ptr, t.HANDLE, t.UINT, t.UINT, t.UINT);
    declare(user, "TranslateMessage", t.BOOL, t.MSG.ptr);
    declare(user, "DispatchMessageW", t.LRESULT, t.MSG.ptr);
    declare(user, "RegisterWindowMessageW", t.UINT, t.WCHAR.ptr);
    declare(user, "CreatePopupMenu", t.HANDLE);
    declare(user, "AppendMenuW", t.BOOL, t.HANDLE, t.UINT, t.WPARAM, t.WCHAR.ptr);
    declare(user, "TrackPopupMenu", t.BOOL, t.HANDLE, t.UINT, c.int32_t, c.int32_t,
      c.int32_t, t.HANDLE, c.voidptr_t);
    declare(user, "DestroyMenu", t.BOOL, t.HANDLE);
    declare(user, "EndMenu", t.BOOL);
    declare(user, "GetCursorPos", t.BOOL, t.POINT.ptr);
    declare(user, "SetForegroundWindow", t.BOOL, t.HANDLE);
    declare(user, "PostMessageW", t.BOOL, t.HANDLE, t.UINT, t.WPARAM, t.LPARAM);
    declare(user, "DestroyIcon", t.BOOL, t.HANDLE);
    declare(user, "CreateIconFromResourceEx", t.HANDLE, c.uint8_t.ptr, t.DWORD, t.BOOL,
      t.DWORD, c.int32_t, c.int32_t, t.UINT);
    declare(user, "SetMenuInfo", t.BOOL, t.HANDLE, t.MENUINFO.ptr);
    declare(user, "SetMenuItemInfoW", t.BOOL, t.HANDLE, t.UINT, t.BOOL, t.MENUITEMINFO.ptr);
    declare(user, "GetDpiForWindow", t.UINT, t.HANDLE);
    declare(user, "GetSystemMetricsForDpi", c.int32_t, c.int32_t, t.UINT);
    declare(user, "GetSysColor", t.DWORD, c.int32_t);
    declare(user, "FillRect", c.int32_t, t.HANDLE, t.RECT.ptr, t.HANDLE);
    declare(user, "DrawTextW", c.int32_t, t.HANDLE, t.WCHAR.ptr, c.int32_t, t.RECT.ptr, t.UINT);
    declare(user, "GetDC", t.HANDLE, t.HANDLE);
    declare(user, "ReleaseDC", c.int32_t, t.HANDLE, t.HANDLE);
    declare(gdi, "CreateSolidBrush", t.HANDLE, t.DWORD);
    declare(gdi, "DeleteObject", t.BOOL, t.HANDLE);
    declare(gdi, "SelectObject", t.HANDLE, t.HANDLE, t.HANDLE);
    declare(gdi, "SetTextColor", t.DWORD, t.HANDLE, t.DWORD);
    declare(gdi, "SetBkMode", c.int32_t, t.HANDLE, c.int32_t);
    declare(gdi, "GetTextExtentPoint32W", t.BOOL, t.HANDLE, t.WCHAR.ptr, c.int32_t, t.POINT.ptr);
    declare(gdi, "CreateFontW", t.HANDLE, c.int32_t, c.int32_t, c.int32_t, c.int32_t, c.int32_t,
      t.DWORD, t.DWORD, t.DWORD, t.DWORD, t.DWORD, t.DWORD, t.DWORD, t.DWORD, t.WCHAR.ptr);
    declare(shell, "Shell_NotifyIconW", t.BOOL, t.DWORD, t.NID.ptr);
    const a = this.api;
    this.instance = a.GetModuleHandleW(null);
    this.className = t.WCHAR.array()(`ZoteroTray_${a.GetCurrentThreadId()}_${Date.now()}`);
    this.taskbarCreated = a.RegisterWindowMessageW("TaskbarCreated");
    if (!this.taskbarCreated) this.nativeError("RegisterWindowMessageW");
    // Both the callback and its backing class-name array are rooted until the
    // HWND is destroyed AND its class unregistered. Sentinel prevents an
    // exception from ever unwinding across the native callback boundary.
    this.callback = t.WNDPROC((hwnd, msg, wp, lp) => {
      try { return this.windowProc(hwnd, msg, wp, lp); }
      catch (error) {
        this.pending.push({ type: "fatal", message: `${error.name}: ${error.message}\n${error.stack || ""}` });
        return t.LRESULT(0);
      }
    }, null, t.LRESULT(0));
    const wc = t.WNDCLASSEX();
    wc.cbSize = t.WNDCLASSEX.size;
    wc.lpfnWndProc = this.callback;
    wc.hInstance = this.instance;
    wc.lpszClassName = this.className;
    if (!a.RegisterClassExW(wc.address())) this.nativeError("RegisterClassExW");
    this.registered = true;
    // An invisible top-level tool window receives TaskbarCreated/session
    // broadcasts. A message-only HWND would miss Explorer's broadcasts.
    this.hwnd = a.CreateWindowExW(0x80, this.className, "Zotero Tray", 0x80000000,
      0, 0, 0, 0, null, null, this.instance, null);
    if (this.hwnd.isNull()) this.nativeError("CreateWindowExW");
    this.menu = a.CreatePopupMenu();
    if (this.menu.isNull()) this.nativeError("CreatePopupMenu");
    this.labels = config.labels;
    // Owner-drawn rows keep the menu readable in Zotero's dark mode without
    // changing undocumented, process-wide Windows theme settings.
    if (!a.AppendMenuW(this.menu, 0, 1, config.labels.show)
      || !a.AppendMenuW(this.menu, 0x800, 0, null)
      || !a.AppendMenuW(this.menu, 0, 2, config.labels.quit)) this.nativeError("AppendMenuW");
    for (const [index, label] of [config.labels.show, "", config.labels.quit].entries()) {
      const text = t.WCHAR.array()(label);
      const accessible = t.MSAAMENUINFO(0xaa0df00d, label.length, text);
      this.accessibleItems.push({ text, accessible });
      const item = t.MENUITEMINFO();
      item.cbSize = t.MENUITEMINFO.size;
      item.fMask = 0x100 | 0x20; // MIIM_FTYPE | MIIM_DATA
      item.fType = index === 1 ? 0x900 : 0x100; // OWNERDRAW + nonselectable separator
      item.dwItemData = c.cast(accessible.address(), c.uintptr_t).value;
      if (!a.SetMenuItemInfoW(this.menu, index, 1, item.address())) this.nativeError("SetMenuItemInfoW");
    }
    this.applyAppearance(config);
    this.nid = t.NID();
    this.nid.cbSize = t.NID.size;
    this.nid.hWnd = this.hwnd;
    this.nid.uID = 1;
    this.nid.uFlags = 1 | 2 | 4 | 0x80; // NIF_MESSAGE | NIF_ICON | NIF_TIP | NIF_SHOWTIP
    this.nid.uCallbackMessage = this.callbackMessage;
    this.nid.hIcon = this.icon;
    for (let i = 0; i < "Zotero".length; i++) this.nid.szTip[i] = "Zotero".charCodeAt(i);
    if (!this.addIcon()) this.nativeError("Shell_NotifyIconW(NIM_ADD)");
    this.timer = setInterval(() => this.pump(), 30);
    postMessage({ type: "ready", pointerBits: t.HANDLE.size * 8,
      readyAt: Date.now(), workerInitMs: Date.now() - initStarted,
      hwnd: c.cast(this.hwnd, c.uintptr_t).value.toString() });
  },

  nativeError(operation) {
    throw new Error(`${operation} failed (Win32 ${this.api.GetLastError()})`);
  },

  addIcon() {
    if (!this.api.Shell_NotifyIconW(0, this.nid.address())) return false;
    this.added = true;
    this.nid.uVersion = 4;
    if (!this.api.Shell_NotifyIconW(4, this.nid.address())) {
      this.nativeError("Shell_NotifyIconW(NIM_SETVERSION)");
    }
    return true;
  },

  windowProc(hwnd, message, wp, lp) {
    const t = this.types;
    if (message === 0x2c) { // WM_MEASUREITEM
      const item = ctypes.cast(t.LPARAM(lp.value ?? lp), t.MEASUREITEM.ptr).contents;
      if (item.CtlType === 1) {
        item.itemWidth = this.menuWidth;
        item.itemHeight = Math.round((item.itemID === 0 ? 9 : 32) * this.dpi / 96);
        return t.LRESULT(1);
      }
    }
    if (message === 0x2b) { // WM_DRAWITEM
      const item = ctypes.cast(t.LPARAM(lp.value ?? lp), t.DRAWITEM.ptr).contents;
      if (item.CtlType === 1) { this.drawMenuItem(item); return t.LRESULT(1); }
    }
    if ([0x1a, 0x31a, 0x2e0].includes(message)) this.pending.push({ type: "appearance-request" });
    if (message === this.callbackMessage) {
      const event = Number((lp.value ?? lp).toString()) & 0xffff;
      if (event === 0x400 || event === 0x401) {
        // NIN_SELECT / NIN_KEYSELECT for NOTIFYICON_VERSION_4.
        this.pending.push({ type: "show" });
      } else if (event === 0x7b && !this.inMenu
        && !this.pending.some(event => event.type === "menu")) {
        // VERSION_4 uses WM_CONTEXTMENU. Also accepting legacy WM_RBUTTONUP
        // queues a second popup for the same click, reopening it after Show.
        this.pending.push({ type: "menu" });
      }
      return t.LRESULT(0);
    }
    if (message === this.taskbarCreated) this.pending.push({ type: "recover" });
    if (message === this.stopMessage) {
      this.stopping = true;
      if (this.inMenu) this.api.EndMenu();
      return t.LRESULT(0);
    }
    if (message === 0x11) { // WM_QUERYENDSESSION
      postMessage({ type: "session-ending", ending: true });
      return t.LRESULT(1);
    }
    if (message === 0x16) { // WM_ENDSESSION (wParam=0 means cancelled)
      postMessage({ type: "session-ending", ending: Number((wp.value ?? wp).toString()) !== 0 });
    }
    return this.api.DefWindowProcW(hwnd, message, wp, lp);
  },

  applyAppearance(config) {
    const a = this.api, t = this.types;
    this.dpi = a.GetDpiForWindow(this.hwnd) || 96;
    const system = { menu: a.GetSysColor(4), text: a.GetSysColor(7),
      highlight: a.GetSysColor(13), highlightText: a.GetSysColor(14), gray: a.GetSysColor(17) };
    // GetSysColor returns COLORREF (BGR); palette and icon helpers use RGB.
    for (const key of Object.keys(system)) system[key] = TrayAppearance.colorRef(system[key]);
    const key = JSON.stringify([config.dark, config.taskbarDark, config.forcedColors, this.dpi, system]);
    if (key === this.appearanceKey) return;
    this.palette = TrayAppearance.palette(config.dark, config.forcedColors, system);
    const oldBrushes = this.brushes;
    this.retiredBrushes.push(...Object.values(oldBrushes));
    this.brushes = {};
    for (const role of ["background", "selected", "separator"]) {
      this.brushes[role] = a.CreateSolidBrush(TrayAppearance.colorRef(this.palette[role]));
      if (this.brushes[role].isNull()) this.nativeError("CreateSolidBrush");
    }
    const info = t.MENUINFO();
    info.cbSize = t.MENUINFO.size;
    info.fMask = 0x12; // MIM_BACKGROUND | MIM_STYLE
    info.dwStyle = 0x80000000; // MNS_NOCHECK
    info.hbrBack = this.brushes.background;
    if (!a.SetMenuInfo(this.menu, info.address())) this.nativeError("SetMenuInfo");
    for (const brush of this.retiredBrushes) a.DeleteObject(brush);
    this.retiredBrushes = [];
    if (this.font) a.DeleteObject(this.font);
    this.font = a.CreateFontW(-Math.round(14 * this.dpi / 96), 0, 0, 0, 400,
      0, 0, 0, 1, 0, 0, 5, 0, "Segoe UI");
    if (this.font.isNull()) this.nativeError("CreateFontW");
    const dc = a.GetDC(this.hwnd);
    if (dc.isNull()) this.nativeError("GetDC");
    const previous = a.SelectObject(dc, this.font);
    try {
      this.menuWidth = Math.round(140 * this.dpi / 96);
      for (const label of Object.values(this.labels)) {
        const extent = t.POINT();
        if (!a.GetTextExtentPoint32W(dc, label, label.length, extent.address())) this.nativeError("GetTextExtentPoint32W");
        this.menuWidth = Math.max(this.menuWidth, extent.x + Math.round(40 * this.dpi / 96));
      }
    } finally { a.SelectObject(dc, previous); a.ReleaseDC(this.hwnd, dc); }
    const size = Math.max(16, Math.min(128, a.GetSystemMetricsForDpi(49, this.dpi)));
    const pixels = TrayAppearance.iconDIB(size, config.taskbarDark, config.forcedColors, system.text);
    const nativeBytes = ctypes.uint8_t.array(pixels.length)(Array.from(pixels));
    const icon = a.CreateIconFromResourceEx(nativeBytes, pixels.length, 1, 0x30000, size, size, 0);
    if (icon.isNull()) this.nativeError("CreateIconFromResourceEx");
    const oldIcon = this.icon;
    this.icon = icon;
    if (this.nid) {
      this.nid.hIcon = icon;
      if (this.added && !a.Shell_NotifyIconW(1, this.nid.address())) this.lastCheck = 0;
    }
    if (oldIcon) a.DestroyIcon(oldIcon);
    this.appearanceKey = key;
    postMessage({ type: "log", message: `Appearance: menu=${config.dark ? "dark" : "light"}, taskbar=${config.taskbarDark ? "dark" : "light"}, highContrast=${!!config.forcedColors}, dpi=${this.dpi}` });
  },

  drawMenuItem(item) {
    const a = this.api, t = this.types, p = this.palette;
    const selected = !!(item.itemState & 1) && item.itemID !== 0;
    a.FillRect(item.hDC, item.rcItem.address(), selected ? this.brushes.selected : this.brushes.background);
    const rect = t.RECT(item.rcItem.left, item.rcItem.top, item.rcItem.right, item.rcItem.bottom);
    const padding = Math.round(16 * this.dpi / 96);
    rect.left += padding; rect.right -= padding;
    if (item.itemID === 0) {
      rect.top = Math.floor((rect.top + rect.bottom) / 2);
      rect.bottom = rect.top + Math.max(1, Math.round(this.dpi / 96));
      a.FillRect(item.hDC, rect.address(), this.brushes.separator);
      return;
    }
    const previousFont = a.SelectObject(item.hDC, this.font);
    const previousMode = a.SetBkMode(item.hDC, 1);
    const previousColor = a.SetTextColor(item.hDC, TrayAppearance.colorRef(selected ? p.selectedText : p.foreground));
    try {
      const text = item.itemID === 1 ? this.labels.show : this.labels.quit;
      a.DrawTextW(item.hDC, text, text.length, rect.address(), 0x20 | 4 | 0x800); // SINGLELINE | VCENTER | NOPREFIX
    } finally {
      a.SetTextColor(item.hDC, previousColor);
      a.SetBkMode(item.hDC, previousMode);
      a.SelectObject(item.hDC, previousFont);
    }
  },

  pump() {
    try {
      const msg = this.types.MSG();
      // Bound each pass so worker messages (including stop) cannot starve.
      for (let i = 0; i < 100 && this.api.PeekMessageW(msg.address(), null, 0, 0, 1); i++) {
        this.api.TranslateMessage(msg.address());
        this.api.DispatchMessageW(msg.address());
      }
      if (this.stopping) { this.cleanup(); return; }
      const events = this.pending.splice(0);
      for (const event of events) {
        if (event.type === "fatal") throw new Error(event.message);
        if (event.type === "menu") this.showMenu();
        else if (event.type === "recover") this.lastCheck = 0;
        else postMessage(event);
      }
      // Explorer may not be ready on the first TaskbarCreated broadcast.
      if (Date.now() - this.lastCheck > 2000) {
        this.lastCheck = Date.now();
        if (!this.api.Shell_NotifyIconW(1, this.nid.address()) && !this.addIcon()) {
          if (++this.recoveryFailures >= 5) throw new Error("Could not restore tray icon after Explorer restart");
        } else this.recoveryFailures = 0;
      }
    } catch (error) { this.fail(error); }
  },

  showMenu() {
    const a = this.api, point = this.types.POINT();
    if (!a.GetCursorPos(point.address())) this.nativeError("GetCursorPos");
    a.SetForegroundWindow(this.hwnd);
    this.inMenu = true;
    // TPM_RETURNCMD | TPM_NONOTIFY | TPM_RIGHTBUTTON: selection is a return
    // value, so there is no menu callback or DOM access inside the WNDPROC.
    const command = a.TrackPopupMenu(this.menu, 0x100 | 0x80 | 2,
      point.x, point.y, 0, this.hwnd, null);
    this.inMenu = false;
    a.PostMessageW(this.hwnd, 0, 0, 0); // Win32 notification-area menu dismissal rule
    if (!this.stopping) {
      if (command === 1) postMessage({ type: "show" });
      if (command === 2) postMessage({ type: "quit" });
    }
  },

  cleanup() {
    clearInterval(this.timer);
    this.timer = null;
    this.stopping = true;
    const a = this.api;
    if (this.added && this.nid) a.Shell_NotifyIconW(2, this.nid.address());
    this.added = false;
    if (this.menu && !this.menu.isNull()) {
      if (!a.DestroyMenu(this.menu)) this.nativeError("DestroyMenu");
      this.menu = null;
      this.accessibleItems = [];
    }
    if (this.hwnd && !this.hwnd.isNull()) {
      if (!a.DestroyWindow(this.hwnd)) this.nativeError("DestroyWindow");
      this.hwnd = null;
    }
    if (this.registered) {
      if (!a.UnregisterClassW(this.className, this.instance)) this.nativeError("UnregisterClassW");
      this.registered = false;
    }
    this.callback = null;
    if (this.icon && !this.icon.isNull()) {
      if (!a.DestroyIcon(this.icon)) this.nativeError("DestroyIcon");
      this.icon = null;
    }
    if (this.font) { a.DeleteObject(this.font); this.font = null; }
    for (const brush of Object.values(this.brushes)) a.DeleteObject(brush);
    for (const brush of this.retiredBrushes) a.DeleteObject(brush);
    this.brushes = {};
    this.retiredBrushes = [];
    this.nid = null;
    this.api = {};
    for (const lib of this.libs.reverse()) lib.close();
    this.libs = [];
    postMessage({ type: "stopped" });
  },

  fail(error) {
    postMessage({ type: "error", message: `${error.name}: ${error.message}\n${error.stack || ""}` });
    // Never forcibly terminate a thread that still owns a native callback.
    // Keep this worker alive if cleanup itself fails, so its callback stays rooted.
    try { this.cleanup(); }
    catch (cleanupError) { postMessage({ type: "log", message: `Cleanup failed: ${cleanupError}` }); }
  }
};

onmessage = function (event) {
  try {
    if (event.data.type === "init") tray.init(event.data);
    else if (event.data.type === "appearance" && tray.hwnd) tray.applyAppearance(event.data);
    else if (event.data.type === "stop") {
      if (tray.libs.length) tray.cleanup();
      else postMessage({ type: "stopped" });
    }
  } catch (error) { tray.fail(error); }
};
