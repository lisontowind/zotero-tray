/* SPDX-License-Identifier: MIT */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
  const messages = [], timers = new Map(), released = [], counts = {};
  let nextTimer = 0, dpi = 96;
  const scope = {
    importScripts() {}, postMessage: message => messages.push(message),
    clearInterval() {},
    setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
    ctypes: { uint8_t: { array: () => bytes => bytes } }
  };
  vm.createContext(scope);
  for (const file of ['appearance.js', 'tray-worker.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../addon/content', file), 'utf8'), scope);
  }
  const tray = scope.tray;
  const handle = kind => {
    counts[kind] = (counts[kind] || 0) + 1;
    return { kind, id: counts[kind], isNull: () => false };
  };
  const release = h => { assert.ok(!released.includes(h), 'handle released twice'); released.push(h); return 1; };
  const struct = () => ({ address() { return this; } });
  struct.size = 40;
  tray.types = { MENUINFO: struct, POINT: struct };
  tray.labels = { show: 'Show Zotero', quit: 'Quit Zotero' };
  tray.hwnd = handle('window'); tray.menu = handle('menu');
  tray.callback = {}; tray.registered = true; tray.className = 'test';
  tray.libs = [{ close() { counts.closed = (counts.closed || 0) + 1; } }];
  tray.api = {
    GetDpiForWindow: () => dpi, GetSysColor: n => n,
    GetSystemMetricsForDpi: (n, d) => Math.round(16 * d / 96),
    CreateSolidBrush: () => handle('brush'), CreateFontW: () => handle('font'),
    CreateIconFromResourceEx: () => handle('icon'), SetMenuInfo: () => 1,
    GetDC: () => handle('dc'), SelectObject: () => null, ReleaseDC: () => 1,
    GetTextExtentPoint32W(dc, label, length, extent) { extent.x = length * 8; return 1; },
    DeleteObject: release, DestroyIcon: release, DestroyMenu: release, DestroyWindow: release,
    UnregisterClassW: () => 1, Shell_NotifyIconW: () => 1, GetLastError: () => 5
  };
  return { tray, scope, messages, timers, counts, released, handle,
    setDpi(value) { dpi = value; },
    tick() { const [id, callback] = timers.entries().next().value; timers.delete(id); callback(); } };
}

const light = { dark: false, taskbarDark: false, forcedColors: false };

test('menu and taskbar theme changes rebuild only the affected resources', () => {
  const { tray, counts, setDpi } = setup();
  tray.applyAppearance(light);
  assert.deepEqual([counts.brush, counts.font, counts.icon], [3, 1, 1]);
  const width = tray.menuWidth;
  tray.applyAppearance({ ...light, dark: true });
  assert.deepEqual([counts.brush, counts.font, counts.icon], [6, 1, 1]);
  assert.equal(tray.menuWidth, width);
  tray.applyAppearance({ ...light, dark: true, taskbarDark: true });
  assert.deepEqual([counts.brush, counts.font, counts.icon], [6, 1, 2]);
  tray.applyAppearance({ ...light, dark: true, taskbarDark: true });
  assert.deepEqual([counts.brush, counts.font, counts.icon], [6, 1, 2]);
  setDpi(192);
  tray.applyAppearance({ ...light, dark: true, taskbarDark: true });
  assert.deepEqual([counts.brush, counts.font, counts.icon], [6, 2, 3]);
  assert.ok(tray.menuWidth > width);
  tray.applyAppearance({ ...light, forcedColors: true });
  assert.deepEqual([counts.brush, counts.font, counts.icon], [9, 2, 4]);
  tray.applyAppearance({ ...light, dark: true, taskbarDark: true, forcedColors: true });
  assert.deepEqual([counts.brush, counts.font, counts.icon], [9, 2, 4]);
});

test('transient cleanup failure retains callbacks and retries without double release', () => {
  const { tray, counts, timers, messages, tick } = setup();
  tray.applyAppearance(light);
  const destroy = tray.api.DestroyWindow;
  let attempts = 0;
  tray.api.DestroyWindow = h => ++attempts === 1 ? 0 : destroy(h);
  tray.requestCleanup();
  assert.equal(tray.menu, null);
  assert.ok(tray.hwnd && tray.callback && tray.registered);
  assert.equal(counts.closed, undefined);
  assert.equal(timers.size, 1);
  tray.requestCleanup(); // A concurrent stop must not bypass the backoff.
  assert.equal(attempts, 1);
  tick();
  assert.equal(tray.callback, null);
  assert.equal(counts.closed, 1);
  assert.equal(timers.size, 0);
  assert.equal(messages.filter(m => m.type === 'stopped').length, 1);
  tray.requestCleanup();
  assert.equal(messages.filter(m => m.type === 'stopped').length, 1);
});

test('permanent cleanup failure exhausts its budget while preserving native roots', () => {
  const { tray, timers, counts, messages, tick } = setup();
  tray.api.DestroyWindow = () => 0;
  tray.requestCleanup();
  while (timers.size) tick();
  assert.equal(tray.cleanupAttempts, 4);
  assert.ok(tray.hwnd && tray.callback && tray.registered && tray.libs.length);
  assert.equal(counts.closed, undefined);
  assert.equal(messages.filter(m => m.type === 'cleanup-error').length, 1);
  assert.equal(messages.filter(m => m.type === 'stopped').length, 0);
  tray.requestCleanup();
  assert.equal(timers.size, 0);
});

test('failed GDI deletion keeps the handle for a subsequent cleanup attempt', () => {
  const { tray, tick, counts } = setup();
  tray.applyAppearance(light);
  const font = tray.font, remove = tray.api.DeleteObject;
  let fail = true;
  tray.api.DeleteObject = h => {
    if (h === font && fail) { fail = false; return 0; }
    return remove(h);
  };
  tray.requestCleanup();
  assert.equal(tray.font, font);
  assert.equal(counts.closed, undefined);
  tick();
  assert.equal(tray.font, null);
  assert.equal(counts.closed, 1);
});

test('failed icon replacement retains both handles until cleanup succeeds', () => {
  const { tray, counts, released } = setup();
  tray.applyAppearance(light);
  const oldIcon = tray.icon, destroy = tray.api.DestroyIcon;
  tray.api.DestroyIcon = () => 0;
  assert.throws(() => tray.applyAppearance({ ...light, taskbarDark: true }), /DestroyIcon/);
  const newIcon = tray.icon;
  assert.notEqual(oldIcon, newIcon);
  assert.equal(tray.retiredIcons[0], oldIcon);
  tray.api.DestroyIcon = destroy;
  tray.requestCleanup();
  assert.ok(released.includes(oldIcon) && released.includes(newIcon));
  assert.equal(counts.closed, 1);
});

test('DLL close failure retries only remaining libraries after native callbacks are gone', () => {
  const { tray, tick, counts } = setup();
  let fail = true, closes = 0;
  tray.libs.unshift({ close() { closes++; if (fail) { fail = false; throw Error('close failed'); } } });
  tray.requestCleanup();
  assert.equal(tray.callback, null);
  assert.equal(tray.libs.length, 1);
  assert.equal(counts.closed, 1);
  tick();
  assert.equal(counts.closed, 1);
  assert.equal(closes, 2);
  assert.equal(tray.cleanupComplete, true);
});

test('appearance messages during deferred cleanup cannot allocate new native resources', () => {
  const { tray, scope, counts } = setup();
  tray.stopping = true;
  scope.onmessage({ data: { type: 'appearance', ...light } });
  assert.equal(counts.brush, undefined);
  assert.equal(counts.icon, undefined);
});
