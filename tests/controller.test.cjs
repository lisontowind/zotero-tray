/* SPDX-License-Identifier: MIT */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function setup() {
  const sandbox = {
    Zotero: { debug() {}, logError() {} },
    Services: { obs: { removeObserver() {} } },
    setTimeout, clearTimeout, Map, Error
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../addon/bootstrap.js'), 'utf8'), sandbox);
  const controller = sandbox.ZoteroTray;
  const base = { visibility: true };
  const listeners = new Map();
  const win = {
    location: { href: 'chrome://zotero/content/zoteroPane.xhtml' }, document: {},
    STATE_MAXIMIZED: 1, STATE_MINIMIZED: 2, windowState: 3, closed: false,
    addEventListener(name, handler) { listeners.set(name, handler); },
    removeEventListener(name) { listeners.delete(name); },
    restore() { this.windowState = 3; }, maximize() { this.windowState = 1; }, focus() {},
    goQuitApplication() {}
  };
  controller.baseWindow = () => base;
  controller.attach(win);
  function close(target = win, type = 'close') {
    const event = { target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() {} };
    listeners.get(type)?.(event);
    return event;
  }
  return { controller, win, base, listeners, close };
}

test('close remains normal until tray is ready', () => {
  const { controller, base, close } = setup();
  assert.equal(close().defaultPrevented, false);
  assert.equal(base.visibility, true);
  controller.ready = true;
  assert.equal(close().defaultPrevented, true);
  assert.equal(base.visibility, false);
});

test('ignores close events from an embedded document', () => {
  const { controller, base, close } = setup();
  controller.ready = true;
  assert.equal(close({ embedded: true }, 'DOMWindowClose').defaultPrevented, false);
  assert.equal(base.visibility, true);
});

test('show restores maximized state and remains idempotent', () => {
  const { controller, win, base, close } = setup();
  controller.ready = true;
  win.windowState = win.STATE_MAXIMIZED;
  close(); close();
  controller.showAll();
  controller.showAll();
  assert.equal(base.visibility, true);
  assert.equal(win.windowState, win.STATE_MAXIMIZED);
});

test('show restores a minimized window without intercepting minimization', () => {
  const { controller, win } = setup();
  win.windowState = win.STATE_MINIMIZED;
  controller.showAll();
  assert.equal(win.windowState, 3);
});

test('tray click activates an already visible native window without changing visibility or maximization', () => {
  const { controller, win, base } = setup();
  let visibilityWrites = 0, foregroundCalls = 0, focusCalls = 0;
  Object.defineProperty(base, 'visibility', { get: () => true, set() { visibilityWrites++; } });
  win.windowState = win.STATE_MAXIMIZED;
  win.focus = () => { focusCalls++; };
  controller.windowHandle = () => 'zotero-window';
  controller.nativeBridge = {
    isVisible: () => 1,
    foreground(handle) { assert.equal(handle, 'zotero-window'); foregroundCalls++; return 1; }
  };
  controller.onMessage({ type: 'show' });
  assert.equal(visibilityWrites, 0);
  assert.equal(foregroundCalls, 1);
  assert.equal(focusCalls, 1);
  assert.equal(win.windowState, win.STATE_MAXIMIZED);
});

test('Windows activation refusal does not disable the tray or change a visible window', () => {
  const { controller, win } = setup();
  controller.ready = true;
  controller.windowHandle = () => 'zotero-window';
  controller.nativeBridge = { isVisible: () => 1, foreground: () => 0 };
  controller.onMessage({ type: 'show' });
  assert.equal(controller.ready, true);
  assert.equal(controller.stopping, false);
  assert.equal(win.windowState, 3);
});

test('quit cancellation keeps later X interception enabled', () => {
  const { controller, close } = setup();
  controller.ready = true;
  controller.quit(); // Fake goQuitApplication cancels without granting quit.
  assert.equal(controller.quitting, false);
  assert.equal(close().defaultPrevented, true);
});

test('requested and granted application quit bypass window interception', () => {
  const { controller, close } = setup();
  controller.ready = true;
  controller.requestingQuit = true;
  assert.equal(close().defaultPrevented, false);
  controller.requestingQuit = false;
  controller.quitting = true;
  assert.equal(close().defaultPrevented, false);
});

test('stop restores hidden window and waits for native cleanup acknowledgement', async () => {
  const { controller, base, listeners, close } = setup();
  controller.ready = true;
  close();
  let terminated = false, stopped = false;
  controller.worker = {
    postMessage(message) {
      assert.equal(message.type, 'stop');
      queueMicrotask(() => { stopped = true; controller.onMessage({ type: 'stopped' }); });
    },
    terminate() { assert.equal(stopped, true); terminated = true; }
  };
  await controller.stop();
  await controller.stop();
  assert.equal(base.visibility, true);
  assert.equal(listeners.size, 0);
  assert.equal(terminated, true);
  assert.equal(controller.worker, null);
});

test('failure while hidden restores window and detaches interception', async () => {
  const { controller, base, listeners, close } = setup();
  controller.ready = true;
  close();
  controller.fail(new Error('simulated worker failure'));
  await controller.stop();
  assert.equal(base.visibility, true);
  assert.equal(listeners.size, 0);
  assert.equal(controller.ready, false);
});

test('duplicate appearance notifications are coalesced but native DPI refresh can force an update', () => {
  const { controller } = setup();
  const messages = [];
  controller.worker = { postMessage(message) { messages.push(message); } };
  controller.appearance = () => ({ dark: true, taskbarDark: true, forcedColors: false });
  controller.updateAppearance();
  controller.updateAppearance();
  assert.equal(messages.length, 1);
  controller.updateAppearance(true);
  assert.equal(messages.length, 2);
  controller.appearance = () => ({ dark: false, taskbarDark: true, forcedColors: false });
  controller.updateAppearance();
  assert.equal(messages.length, 3);
});
