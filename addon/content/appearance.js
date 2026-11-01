/* SPDX-License-Identifier: MIT */
"use strict";

// Small, code-defined Z icon. No rasterizer, executable or external asset loader.
var TrayAppearance = {
  coverageCache: new Map(),
  palette(dark, forced, system = {}) {
    if (forced) return {
      background: system.menu, foreground: system.text,
      selected: system.highlight, selectedText: system.highlightText,
      separator: system.gray
    };
    return dark
      ? { background: 0x252526, foreground: 0xf2f2f2, selected: 0x3d3d40, selectedText: 0xffffff, separator: 0x59595c }
      : { background: 0xffffff, foreground: 0x202020, selected: 0xe8e8e8, selectedText: 0x101010, separator: 0xd0d0d0 };
  },

  colorRef(rgb) { return ((rgb & 255) << 16) | (rgb & 0xff00) | ((rgb >>> 16) & 255); },

  coverage(size) {
    if (this.coverageCache.has(size)) return this.coverageCache.get(size);
    const points = [[3, 3], [13, 3], [13, 5], [6.5, 11], [13, 11], [13, 13], [3, 13], [3, 11], [9.5, 5], [3, 5]];
    const edges = points.map(([bx, by], i) => {
      const [ax, ay] = points[(i + points.length - 1) % points.length];
      const dx = bx - ax, dy = by - ay;
      return { ax, ay, bx, by, dx, dy, length2: dx * dx + dy * dy,
        minX: Math.min(ax, bx) - 0.55, maxX: Math.max(ax, bx) + 0.55,
        minY: Math.min(ay, by) - 0.55, maxY: Math.max(ay, by) + 0.55 };
    });
    function sample(x, y) {
      if (x < 2.4 || x > 13.6 || y < 2.4 || y > 13.6) return 0;
      let inside = false;
      for (const e of edges) {
        if ((e.ay > y) !== (e.by > y) && x < e.dx * (y - e.ay) / e.dy + e.ax) inside = !inside;
      }
      if (inside) return 1;
      for (const e of edges) {
        if (x < e.minX || x > e.maxX || y < e.minY || y > e.maxY) continue;
        const t = Math.max(0, Math.min(1, ((x - e.ax) * e.dx + (y - e.ay) * e.dy) / e.length2));
        const dx = x - e.ax - t * e.dx, dy = y - e.ay - t * e.dy;
        if (dx * dx + dy * dy < 0.55 * 0.55) return 2;
      }
      return 0;
    }
    // Geometry is independent of theme. Reuse coverage when changing colors;
    // bounding boxes and squared distances avoid expensive per-edge square roots.
    const coverage = new Uint8Array(size * size * 2);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 2;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
        const kind = sample((x + (sx + 0.5) / 4) * 16 / size, (y + (sy + 0.5) / 4) * 16 / size);
        if (kind) coverage[offset + kind - 1]++;
      }
    }
    if (this.coverageCache.size >= 8) this.coverageCache.delete(this.coverageCache.keys().next().value);
    this.coverageCache.set(size, coverage);
    return coverage;
  },

  iconDIB(size, dark, forced = false, systemText = 0xffffff) {
    if (!Number.isInteger(size) || size < 16 || size > 128) throw new Error("Invalid icon size");
    const coverage = this.coverage(size);
    const maskStride = Math.ceil(size / 32) * 4;
    const xorBytes = size * size * 4;
    const bytes = new Uint8Array(40 + xorBytes + maskStride * size);
    const header = new DataView(bytes.buffer);
    header.setUint32(0, 40, true);
    header.setInt32(4, size, true);
    header.setInt32(8, size * 2, true);
    header.setUint16(12, 1, true);
    header.setUint16(14, 32, true);
    header.setUint32(20, xorBytes, true);
    const fill = forced ? systemText : 0xd62934;
    const outline = forced
      ? (((systemText >>> 16) & 255) + ((systemText >>> 8) & 255) + (systemText & 255) > 382 ? 0x000000 : 0xffffff)
      : (dark ? 0xf5f5f5 : 0x901b23);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const coverageOffset = (y * size + x) * 2;
      const fillCount = coverage[coverageOffset], outlineCount = coverage[coverageOffset + 1];
      const count = fillCount + outlineCount;
      const row = size - y - 1;
      const offset = 40 + (row * size + x) * 4;
      if (count) {
        bytes[offset] = Math.round(((fill & 255) * fillCount + (outline & 255) * outlineCount) / count);
        bytes[offset + 1] = Math.round((((fill >>> 8) & 255) * fillCount + ((outline >>> 8) & 255) * outlineCount) / count);
        bytes[offset + 2] = Math.round((((fill >>> 16) & 255) * fillCount + ((outline >>> 16) & 255) * outlineCount) / count);
        bytes[offset + 3] = Math.round(count * 255 / 16);
      } else bytes[40 + xorBytes + row * maskStride + (x >>> 3)] |= 0x80 >>> (x & 7);
    }
    return bytes;
  }
};
