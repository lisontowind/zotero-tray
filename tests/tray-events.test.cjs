/* SPDX-License-Identifier: MIT */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup() {
  const scope = { importScripts() {}, postMessage() {} };
  vm.createContext(scope);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../addon/content/tray-worker.js'), 'utf8'), scope);
  scope.tray.types = { LRESULT: value => value };
  const notify = event => scope.tray.windowProc(null, scope.tray.callbackMessage, 0, event);
  return { tray: scope.tray, notify, scope };
}

test('one physical right click with legacy and VERSION_4 notifications queues one menu', () => {
  const { tray, notify } = setup();
  notify(0x205); // legacy WM_RBUTTONUP
  notify(0x7b); // VERSION_4 WM_CONTEXTMENU
  notify(0x7b); // duplicate notification before pumping
  assert.equal(tray.pending.filter(event => event.type === 'menu').length, 1);
});

test('click notifications while a menu is tracking cannot reopen it after selection', () => {
  const { tray, notify } = setup();
  tray.inMenu = true;
  notify(0x7b);
  notify(0x205);
  assert.equal(tray.pending.length, 0);
  tray.inMenu = false;
  notify(0x7b);
  assert.equal(tray.pending.length, 1);
});

test('mouse and keyboard activation retain the VERSION_4 Show action', () => {
  const { tray, notify } = setup();
  notify(0x400);
  notify(0x401);
  notify(0x202); // legacy notification must not duplicate modern selection
  assert.equal(tray.pending.length, 2);
  assert.ok(tray.pending.every(event => event.type === 'show'));
});

test('context menu preserves signed icon coordinates for secondary displays', () => {
  const { tray } = setup();
  const packed = ((-500 & 0xffff) << 16) | (-1200 & 0xffff);
  tray.windowProc(null, tray.callbackMessage, packed, 0x7b);
  assert.equal(tray.menuPosition.x, -1200);
  assert.equal(tray.menuPosition.y, -500);
});

test('popup moves the hidden owner to the icon monitor and refreshes DPI before tracking', () => {
  const { tray } = setup();
  const calls = [];
  tray.types.POINT = () => ({ x: 0, y: 0 });
  tray.menuPosition = { x: -1200, y: 500 };
  tray.appearanceConfig = { dark: true };
  tray.api = {
    SetWindowPos(hwnd, after, x, y, width, height, flags) {
      calls.push('move');
      assert.deepEqual([x, y, flags], [-1200, 500, 0x15]);
      return 1;
    },
    SetForegroundWindow() { return 1; },
    TrackPopupMenu(menu, flags, x, y) { calls.push('menu'); assert.deepEqual([x, y], [-1200, 500]); return 0; },
    PostMessageW() { return 1; }
  };
  tray.applyAppearance = config => { calls.push('appearance'); assert.equal(config.dark, true); };
  tray.showMenu();
  assert.deepEqual(calls, ['move', 'appearance', 'menu']);
  assert.equal(tray.menuPosition, null);
});

test('icon health checks run every ten seconds when healthy and retry each second after failure', () => {
  const { tray, scope } = setup();
  let now = 20000, checks = 0, healthy = true;
  scope.Date = { now: () => now };
  tray.types.MSG = () => ({ address() {} });
  tray.nid = { address() {} };
  tray.taskbarCreated = 0xc001;
  tray.api = { PeekMessageW: () => 0, DefWindowProcW: () => 0,
    Shell_NotifyIconW() { checks++; return healthy ? 1 : 0; } };
  tray.addIcon = () => false;
  tray.pump();
  assert.equal(checks, 1);
  for (let i = 0; i < 99; i++) { now += 100; tray.pump(); }
  assert.equal(checks, 1);
  now += 200;
  healthy = false;
  tray.pump();
  assert.equal(checks, 2);
  assert.equal(tray.recoveryFailures, 1);
  now += 1100;
  healthy = true;
  tray.pump();
  assert.equal(checks, 3);
  assert.equal(tray.recoveryFailures, 0);
  tray.windowProc(null, tray.taskbarCreated, 0, 0);
  tray.pump();
  assert.equal(checks, 4); // Explorer's broadcast bypasses the healthy check interval.
});
