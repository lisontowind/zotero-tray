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
  return { tray: scope.tray, notify };
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
