/* SPDX-License-Identifier: MIT */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const scope = {};
vm.createContext(scope);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../addon/content/appearance.js'), 'utf8'), scope);
const appearance = scope.TrayAppearance;

function luminance(rgb) {
  return [rgb >>> 16 & 255, rgb >>> 8 & 255, rgb & 255].map(v => {
    v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}

test('light/dark menu text exceeds 7:1 contrast including selection', () => {
  for (const dark of [false, true]) {
    const p = appearance.palette(dark, false);
    for (const [a, b] of [[p.background, p.foreground], [p.selected, p.selectedText]]) {
      const x = luminance(a), y = luminance(b);
      assert.ok((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) > 7);
    }
  }
});

test('high contrast uses all supplied Windows colors', () => {
  const p = appearance.palette(true, true, { menu: 1, text: 2, highlight: 3, highlightText: 4, gray: 5 });
  assert.equal(p.background, 1); assert.equal(p.foreground, 2);
  assert.equal(p.selected, 3); assert.equal(p.selectedText, 4); assert.equal(p.separator, 5);
});

test('icon DIBs have correct layout, transparent margins and theme-dependent edges at each DPI', () => {
  for (const size of [16, 20, 24, 28, 32, 48, 64]) {
    const light = appearance.iconDIB(size, false), dark = appearance.iconDIB(size, true);
    const header = new DataView(light.buffer);
    assert.equal(header.getUint32(0, true), 40);
    assert.equal(header.getInt32(4, true), size);
    assert.equal(header.getInt32(8, true), size * 2);
    assert.equal(header.getUint16(14, true), 32);
    assert.equal(light.length, 40 + size * size * 4 + Math.ceil(size / 32) * 4 * size);
    assert.equal(light[43], 0);
    assert.notDeepEqual(Array.from(light), Array.from(dark));
    assert.ok(Array.from(light.slice(40, 40 + size * size * 4)).some((v, i) => i % 4 === 3 && v === 255));
  }
});

test('theme changes reuse bounded geometry cache without sharing mutable icon buffers', () => {
  const light = appearance.iconDIB(28, false);
  const coverage = appearance.coverage(28);
  const dark = appearance.iconDIB(28, true);
  assert.equal(appearance.coverage(28), coverage);
  assert.notEqual(light.buffer, dark.buffer);
  const original = appearance.iconDIB(28, true)[100];
  dark[100] ^= 0xff;
  assert.equal(appearance.iconDIB(28, true)[100], original);
  for (let size = 16; size < 30; size++) appearance.coverage(size);
  assert.ok(appearance.coverageCache.size <= 8);
});
