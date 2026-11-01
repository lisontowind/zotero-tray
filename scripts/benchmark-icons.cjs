/* Compare icon work and pixel output against the saved pre-optimization source. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const root = path.resolve(__dirname, '..');
const baseline = path.join(root, 'artifacts/performance/baseline-appearance.js');
const current = path.join(root, 'addon/content/appearance.js');
function load(file) {
  const scope = {};
  vm.createContext(scope);
  vm.runInContext(fs.readFileSync(file, 'utf8'), scope);
  return scope.TrayAppearance;
}
function measure(file) {
  const timings = [];
  for (let i = 0; i < 7; i++) {
    const icons = load(file);
    const start = performance.now();
    icons.iconDIB(28, true);
    timings.push(performance.now() - start);
  }
  const icons = load(file), pixels = {};
  for (const size of [16, 20, 24, 28, 32, 48, 64]) for (const dark of [false, true]) {
    const data = icons.iconDIB(size, dark);
    pixels[`${size}-${dark}`] = crypto.createHash('sha256').update(data).digest('hex');
  }
  timings.sort((a, b) => a - b);
  return { cold28ms: timings, medianCold28ms: timings[3], pixels };
}
const old = measure(baseline), updated = measure(current);
for (const key of Object.keys(old.pixels)) {
  if (old.pixels[key] !== updated.pixels[key]) throw Error(`Changed pixels: ${key}`);
}
const result = { before: old, after: updated, identicalImages: Object.keys(old.pixels).length,
  speedup: old.medianCold28ms / updated.medianCold28ms };
fs.writeFileSync(path.join(root, 'artifacts/performance/icon-benchmark.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ beforeMs: old.medianCold28ms, afterMs: updated.medianCold28ms,
  speedup: result.speedup, identicalImages: result.identicalImages }, null, 2));
