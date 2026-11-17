// Reading settings back from the mouse. The M3 replies are live captures from a real M3 Pro
// (github.com/duyzoz/Smail-Wolf-M3-Pro, tests/hid.test.ts).
const W = process.argv[2];
const { attach } = await import(W + '/models/index.js');
const { sealCrc } = await import(W + '/protocols/hidpp.js');
const assert = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) process.exitCode = 1; };
const j = JSON.stringify;

const cfg198 = [
  0x0e, 0xa5, 0xc6, 0x2e, 0x01, 0x01, 0x01, 0x00, 0x00, 0x01, 0x06, 0x03, 0x20, 0x03, 0x40, 0x06, 0x60, 0x09, 0x80, 0x0c, 0x00, 0x19, 0xe0, 0x2e,
  ...Array(24).fill(0), 0x00, 0x01, 0x00, 0x05, ...Array(12).fill(0),
];
const keysLive = [
  0x08, 0xa5, 0xf0, 0x20, 0, 0, 0,
  0x20, 0x01, 0, 0, 0x20, 0x02, 0, 0, 0x20, 0x04, 0, 0,
  0x10, 0x01, 0x19, 0, 0x10, 0x01, 0x06, 0, 0x21, 0x55, 0, 0,
  0x21, 0x38, 0x01, 0, 0x21, 0x38, 0xff, 0, ...Array(25).fill(0),
];
function m3(replies) {
  const ls = []; const sent = [];
  return { sent, vendorId: 0xa8a5, productId: 1, productName: 'USB Receiver', opened: true,
    collections: [{ usagePage: 0xff01, usage: 0x10, outputReports: [] }, { usagePage: 0xff02, usage: 1, outputReports: [{ reportId: 0xf0 }] }],
    async open() {}, addEventListener(_, f) { ls.push(f); },
    async sendReport(id, d) { sent.push(d[0]); const r = replies[d[0]]; if (r) setTimeout(() => ls.forEach((l) => l({ data: new DataView(Uint8Array.from(r).buffer) })), 1); } };
}
const kb = await attach([m3({ 0x0e: cfg198, 0x08: keysLive })], {});
assert(kb?.model.id === 'm3pro', 'M3 found with report 0xF0 declared in another collection');
const c = await kb.readMouseConfig();
assert(c.rate === 1 && j(c.dpi) === j([800, 1600, 2400, 3200, 6400, 12000]) && c.dpiIndex === 2, 'M3 live config: 125 Hz, six DPI stages, stage 3 active');
assert(c.angleSnap === 1 && c.sleep === 5 && c.liftoff === 0 && c.debounce === 0 && c.scrollReverse === 0, 'M3 live config: line correction on, sleep 5 min');
assert(c.buttons.slice(0, 3).every((b) => b === null) && c.buttons.slice(5).every((b) => b === null), 'M3 live keys: left/right/middle/DPI/wheel are defaults');
assert(j(c.buttons[3]) === j({ type: 'key', mods: 1, code: 0x19 }) && j(c.buttons[4]) === j({ type: 'key', mods: 1, code: 0x06 }), 'M3 live keys: side buttons are Ctrl+V and Ctrl+C');
// writing back what was read reproduces the captured key block
const dev2 = m3({ 0x0e: cfg198, 0x08: keysLive }); const kb2 = await attach([dev2], {});
const got = await kb2.readMouseConfig(); let wrote = null; const orig = dev2.sendReport;
dev2.sendReport = async (id, d) => { if (d[0] === 0x09) wrote = Array.from(d.slice(7, 39)); return orig.call(dev2, id, d); };
await kb2.setButtons(got.buttons, []);
assert(j(wrote) === j(keysLive.slice(7, 39)), 'M3 read -> write round-trips the 8 key slots byte for byte');
const badSum = cfg198.slice(); badSum[20] ^= 1; let e = null;
await (await attach([m3({ 0x0e: badSum, 0x08: keysLive })], {})).readMouseConfig().catch((x) => (e = x));
assert(e && /checksum/.test(e.message), 'M3 corrupted reply is rejected');

// G304: profile with 4 DPI stages (5th disabled), 2 ms, assorted bindings
const SIZE = 255; const prof = new Uint8Array(SIZE).fill(0xff);
prof.set([2, 1, 0, 0x90, 0x01, 0x20, 0x03, 0x40, 0x06, 0x80, 0x0c, 0, 0], 0);
[[0x80, 1, 0, 1], [0x80, 2, 1, 0x19], [0x80, 3, 0, 0xcd], [0xff, 0, 0, 0], [0x90, 5, 0, 0], [0x00, 1, 0, 4]].forEach((b, i) => prof.set(b, 32 + i * 4));
sealCrc(prof);
const ls = [];
const g = { vendorId: 0x046d, productId: 0xc53f, productName: 'USB Receiver', opened: true,
  collections: [{ usagePage: 0xff00, usage: 2, outputReports: [{ reportId: 0x11 }] }], async open() {}, addEventListener(_, f) { ls.push(f); },
  async sendReport(id, d) { const r = new Uint8Array(19); r.set(d.slice(0, 3)); const fn = d[2] >> 4; const p = d.slice(3);
    if (d[0] !== 1) { setTimeout(() => ls.forEach((l) => l({ reportId: 0x10, data: new DataView(new Uint8Array([d[0], 0x8f, d[1], d[2], 9, 0, 0]).buffer) })), 1); return; }
    if (d[1] === 0 && fn === 1) r[3] = 4;
    else if (d[1] === 0) r[3] = { 0x2201: 5, 0x8100: 7 }[(p[0] << 8) | p[1]] ?? 0;
    else if (d[1] === 7 && fn === 0) r.set([1, 1, 1, 1, 0, 6, 16, 0, SIZE], 3);
    else if (d[1] === 7 && fn === 4) r.set([0, 1], 3);
    else if (d[1] === 7 && fn === 5) { const o = (p[2] << 8) | p[3]; r.set(prof.subarray(o, o + 16), 3); }
    else throw new Error('unexpected write during read');
    setTimeout(() => ls.forEach((l) => l({ reportId: 0x11, data: new DataView(r.buffer) })), 1); } };
const kg = await attach([g], {});
const gc = await kg.readMouseConfig();
assert(gc.rate === 3 && j(gc.dpi) === j([400, 800, 1600, 3200]) && gc.dpiIndex === 1, 'G304 profile: 500 Hz, four DPI stages, stage 2 default');
assert(j(gc.buttons) === j([{ type: 'mouse', id: 1 }, { type: 'key', mods: 1, code: 0x19 }, { type: 'media', usage: 0xcd }, { type: 'disable' }, { type: 'dpiLoop' }, null]), 'G304 bindings decoded; macro binding left as "keep"');
