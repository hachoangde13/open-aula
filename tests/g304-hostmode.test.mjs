const W = process.argv[2];
const { HidPP, FEATURE } = await import(W + '/protocols/hidpp.js');
const { attach, hidFilters } = await import(W + '/models/index.js');
const assert = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) process.exitCode = 1; };
// receiver: device 1 = keyboard (no DPI), device 2 = mouse; devices 3..6 absent (HID++1.0 error 0x8f)
const FEATS = { 1: { 0x1004: 4 }, 2: { 0x1000: 3, 0x2201: 5, 0x8060: 6 } }; // a mouse without onboard profiles: host-mode fallback
const listeners = []; const sent = []; const state = { dpi: 0, rate: 0, mode: 0 };
const dev = { vendorId: 0x046d, productId: 0xc539, productName: 'USB Receiver', opened: false,
  collections: [{ usagePage: 0xff00, usage: 2, outputReports: [{ reportId: 0x11 }], inputReports: [{ reportId: 0x11 }] }],
  async open() { this.opened = true; }, addEventListener(_, f) { listeners.push(f); },
  async sendReport(id, d) { sent.push([id, ...d]); const [ix, fi, fs] = d; const fn = fs >> 4;
    let r = new Uint8Array(19); r.set(d.slice(0, 3));
    const f = FEATS[ix];
    if (!f) { r = new Uint8Array([ix, 0x8f, fi, fs, 0x09, 0, 0]); }
    else if (fi === 0 && fn === 1) { r[3] = 4; r[4] = 2; }
    else if (fi === 0 && fn === 0) r[3] = f[(d[3] << 8) | d[4]] ?? 0;
    else if (ix === 2 && fi === 5 && fn === 3) state.dpi = (d[4] << 8) | d[5];
    else if (ix === 2 && fi === 6 && fn === 2) state.rate = d[3];
    else if (ix === 2 && fi === 7 && fn === 1) state.mode = d[3];
    else if (ix === 2 && fi === 3 && fn === 0) r[3] = 85;
    const rid = r.length === 7 ? 0x10 : 0x11;
    setTimeout(() => listeners.forEach((l) => l({ reportId: rid, data: new DataView(r.buffer) })), 2); } };
const kb = await attach([dev], {});
assert(kb instanceof HidPP && kb.model.id === 'g304' && kb.index === 2, 'finds the mouse at device index 2, skips keyboard');
await kb.setMouseConfig({ dpi: [400, 800, 1630, 3200, 6400], dpiIndex: 2, rate: 3 });
assert(state.dpi === 1650 && state.rate === 2, `fallback: dpi 1650, 2 ms (got ${JSON.stringify(state)})`);
assert(await kb.battery() === 85, 'battery via feature 0x1000');
await kb.setMouseConfig({ dpi: [99999], dpiIndex: 0, rate: 4 });
assert(state.dpi === 12000 && state.rate === 1, 'dpi clamped to 12000, 1000 Hz');
assert(sent.every((s) => s[0] === 0x11 && s.length === 20 && (s[3] & 15) === 0x0a), 'long reports, software id 0x0a');
let e = null; await kb.setButtons().catch((x) => (e = x)); assert(e && /not supported/.test(e.message), 'buttons unsupported');
assert(hidFilters().some((f) => f.vendorId === 0x046d && f.productId === 0xc539), 'receiver in filters');
const sim = new HidPP({}, kb.model); await sim.setMouseConfig({ dpi: [800], dpiIndex: 0, rate: 4 }); assert(await sim.battery() === null, 'simulator works');
