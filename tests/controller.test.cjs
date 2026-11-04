/* SPDX-License-Identifier: MIT */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function setup(application = { debug() {}, logError() {} }) {
  const sandbox = {
    Zotero: application,
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
  return { controller, win, base, listeners, close, application, sandbox };
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

test('unresponsive worker bounds shutdown while retaining native resources until late acknowledgement', async () => {
  const { controller, base, close, application } = setup();
  controller.ready = true;
  close();
  controller.stopTimeoutMs = 10;
  let terminated = false, libraryClosed = false, chromeRemoved = false;
  controller.worker = { postMessage() {}, terminate() { terminated = true; } };
  controller.windowHandle = () => 'main-window';
  controller.nativeBridge = {
    isVisible: () => 0, foreground: () => 1,
    user32: { close() { libraryClosed = true; } }
  };
  controller.chromeHandle = { destruct() { chromeRemoved = true; } };
  assert.equal(await controller.stop(), false);
  assert.equal(base.visibility, true);
  assert.equal(controller.stopTimedOut, true);
  assert.equal(application.__zoteroTrayPendingCleanup.has(controller), true);
  assert.equal(terminated || libraryClosed || chromeRemoved, false);

  application.isWin = true;
  const replacement = setup(application).controller;
  await replacement.start({});
  assert.equal(replacement.worker, null); // A reload must not create a second native worker.

  controller.onMessage({ type: 'stopped' });
  assert.equal(terminated && libraryClosed && chromeRemoved, true);
  assert.equal(controller.worker, null);
  assert.equal(controller.stopTimedOut, false);
  assert.equal(application.__zoteroTrayPendingCleanup, undefined);
});

test('cleanup failure resolves shutdown without unsafe termination and can release on a later acknowledgement', async () => {
  const { controller, application } = setup();
  let terminated = false;
  controller.worker = {
    postMessage() { queueMicrotask(() => controller.onMessage({ type: 'cleanup-error', message: 'DestroyWindow failed' })); },
    terminate() { terminated = true; }
  };
  assert.equal(await controller.stop(), false);
  assert.equal(terminated, false);
  assert.equal(controller.stopTimer, null);
  assert.ok(application.__zoteroTrayPendingCleanup.has(controller));
  controller.onMessage({ type: 'stopped' });
  assert.equal(terminated, true);
});

test('failure to send the native wake message still sends the cooperative JS stop', async () => {
  const { controller } = setup();
  controller.nativeBridge = {
    hwnd: 'native-window', post() { throw Error('native post failed'); }, user32: { close() {} }
  };
  controller.worker = {
    postMessage() { queueMicrotask(() => controller.onMessage({ type: 'stopped' })); }, terminate() {}
  };
  assert.equal(await controller.stop(), true);
  assert.equal(controller.worker, null);
});

test('failure to send the JS stop does not leave shutdown pending forever', async () => {
  const { controller } = setup();
  let terminated = false;
  controller.worker = { postMessage() { throw Error('worker unavailable'); }, terminate() { terminated = true; } };
  assert.equal(await controller.stop(), false);
  assert.equal(terminated, false);
  controller.onMessage({ type: 'stopped' });
  assert.equal(terminated, true);
});

test('each native bridge declaration failure closes the already opened DLL', async () => {
  for (const failAt of [1, 2, 3]) {
    const { controller, sandbox, application, base } = setup();
    let closed = 0, terminated = 0, declarations = 0, removed = 0;
    application.isWin = true;
    application.getMainWindows = () => [];
    controller.appearance = () => ({});
    sandbox.Services = {
      io: { newURI: x => x }, obs: { addObserver() {}, removeObserver() {} },
      dirsvc: { get: () => ({ path: 'C:\\Windows\\System32' }) },
      locale: { appLocaleAsBCP47: 'en-US' }
    };
    sandbox.Components = {
      interfaces: {}, classes: { '@mozilla.org/addons/addon-manager-startup;1': {
        getService: () => ({ registerChrome: () => ({ destruct() { removed++; } }) })
      } }
    };
    sandbox.ChromeUtils = { importESModule: () => ({ ctypes: { open: () => ({
      declare() { if (++declarations === failAt) throw Error('injected declaration failure'); return () => 1; },
      close() { closed++; }
    }) } }) };
    sandbox.ChromeWorker = function() {
      this.postMessage = message => {
        if (message.type === 'stop') queueMicrotask(() => this.onmessage({ data: { type: 'stopped' } }));
      };
      this.terminate = () => { terminated++; };
    };
    await controller.start({ rootURI: 'test/', version: 'test' });
    await controller.stop();
    assert.equal(closed, 1);
    assert.equal(terminated, 1);
    assert.equal(removed, 1);
    assert.equal(controller.nativeBridge, null);
    assert.equal(base.visibility, true);
  }
});

test('failure notifications are deduplicated and copy diagnostics only on a click', async () => {
  const { controller, sandbox, application } = setup();
  const notices = [], copies = [];
  application.version = '10.0.7';
  sandbox.Services.locale = { appLocaleAsBCP47: 'zh-CN' };
  sandbox.Components = { interfaces: {}, classes: {
    '@mozilla.org/alerts-service;1': { getService: () => ({ showAlertNotification(...args) { notices.push(args); } }) },
    '@mozilla.org/widget/clipboardhelper;1': { getService: () => ({ copyString(value) { copies.push(value); } }) }
  } };
  controller.fail(Error('example fault'));
  await controller.stop();
  controller.fail(Error('repeated fault'));
  assert.equal(notices.length, 1);
  assert.equal(copies.length, 0);
  const observer = notices[0][5];
  observer.observe(null, 'alertfinished');
  assert.equal(copies.length, 0);
  observer.observe(null, 'alertclickcallback');
  assert.equal(JSON.parse(copies[0]).zoteroVersion, '10.0.7');
  assert.match(JSON.parse(copies[0]).error, /example fault/);
  controller.deferStop(Error('cleanup exhausted'));
  assert.equal(notices.length, 2);
  assert.match(notices[1][2], /重启 Zotero/);
  assert.equal(JSON.parse(controller.diagnostics()).cleanupPending, true);
  controller.notifyFailure();
  controller.notifyFailure(true);
  assert.equal(notices.length, 2);
});

test('unavailable desktop notifications use a non-modal fallback and shutdown stays silent', () => {
  const { controller, sandbox, application } = setup();
  let shown = 0;
  sandbox.Services.locale = { appLocaleAsBCP47: 'en-US' };
  application.ProgressWindow = function() {
    this.changeHeadline = () => {};
    this.addDescription = message => { assert.match(message, /debug log/); };
    this.show = () => { shown++; };
    this.startCloseTimer = () => {};
  };
  controller.notifyFailure();
  assert.equal(shown, 1);
  controller.quitting = true;
  controller.notifyFailure(true);
  assert.equal(shown, 1);
});
