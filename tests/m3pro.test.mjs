const W = process.argv[2];
const { SmailM3 } = await import(W + '/protocols/smailm3.js');
const m3pro = (await import(W + '/models/m3pro.js')).default;
const { MODELS, hidFilters, modelForDevice, attach } = await import(W + '/models/index.js');
const assert = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const eq = (a, b, m) => assert(JSON.stringify(Array.from(a)) === JSON.stringify(Array.from(b)), m + (JSON.stringify(Array.from(a)) === JSON.stringify(Array.from(b)) ? '' : `\n   got ${Array.from(a)}\n   exp ${Array.from(b)}`));
globalThis.performance ??= { now: () => Date.now() };

function fakeDev({ vendorId = 0xa8a5, productId = 0x1234, reply = true } = {}) {
  const listeners = []; const sent = [];
  return { sent, vendorId, productId, productName: 'USB Receiver', opened: false,
    collections: [{ usagePage: 0xff01, usage: 0x10, outputReports: [{ reportId: 0xf0, items: [{ reportSize: 8, reportCount: 63 }] }], inputReports: [] }],
    async open() { this.opened = true; },
    addEventListener(_, f) { listeners.push(f); },
    async sendReport(id, d) { sent.push([id, ...d]);
      if (reply) setTimeout(() => { const r = new Uint8Array(63); r[0] = d[0]; r[7] = 77; listeners.forEach((f) => f({ data: new DataView(r.buffer) })); }, 5); },
  };
}

const dev = fakeDev();
const kb = await attach([dev], {});
assert(kb instanceof SmailM3 && kb.model.id === 'm3pro' && kb.mode === '2.4g', 'attach picks M3 on dongle VID');
assert(modelForDevice({ vendorId: 0xa8a4, productId: 0x2255, productName: '' }).id === 'sc620', 'SC620 IDs still pick SC620');
assert(hidFilters().some((f) => f.vendorId === 0xa8a5 && f.usagePage === 0xff01 && f.usage === 0x10 && !('productId' in f)), 'filter by vendor + usage');

// config: compare with the community driver's proven buildSetConfig for the same values
const cfg = { rate: 4, dpi: [800, 1600, 2400, 3200, 6400, 12000], dpiIndex: 1, dpiColors: [], scrollReverse: 1, liftoff: 1, angleSnap: 1, debounce: 8, sleep: 10, esports: 0 };
await kb.setMouseConfig(cfg);
const exp = Array(64).fill(0);
Object.assign(exp, { 0: 240, 1: 15, 2: 174, 3: 10, 4: 47, 5: 1, 6: 1, 7: 1, 10: 4, 11: 6, 12: 2, 48: 1, 49: 1, 50: 1, 51: 8, 52: 10, 53: 0, 54: 0 });
cfg.dpi.forEach((v, i) => { exp[13 + i * 2] = v & 255; exp[14 + i * 2] = v >> 8; });
eq(dev.sent.at(-1), exp, 'config write == proven bytes');

await kb.setButtons([null, { type: 'key', mods: 1, code: 0x19 }], []);
const k = Array(64).fill(0);
[240, 9, 165, 34, 44, 0, 0, 0].forEach((b, i) => (k[i] = b));
[[32,1,0,0],[16,1,0x19,0],[32,4,0,0],[32,8,0,0],[32,16,0,0],[33,85,0,0],[33,56,1,0],[33,56,255,0]].forEach((s, i) => s.forEach((b, j) => (k[8 + i * 4 + j] = b)));
eq(dev.sent.at(-1), k, 'keys write (right = Ctrl+V)');

dev.sent.length = 0;
await kb.setMacros([{ steps: [{ kind: 'KEY_DOWN', code: 0xe0 }, { kind: 'delay', ms: 30 }, { kind: 'KEY_DOWN', code: 4 }, { kind: 'KEY_UP', code: 4 }, { kind: 'KEY_UP', code: 0xe0 }] }]);
const body = [...[68, 0], ...Array(62).fill(0), 0, 0, 128, 0, 30, 0, 0x41, 1, 2, 0, 0x42, 4, 2, 0, 0x02, 4, 2, 0, 0x81, 1];
const c1 = body.slice(0, 56), c2 = body.slice(56);
const sum = (a) => a.reduce((s, b) => s + b, 0) & 255;
eq(dev.sent[0].slice(0, 8 + 56), [240, 13, 0, sum([56, 0, 0, 0, ...c1]), 56, 0, 0, 0, ...c1], 'macro chunk 1');
eq(dev.sent[1].slice(0, 8 + c2.length), [240, 13, 0, sum([c2.length, 56, 0, 0, ...c2]), c2.length, 56, 0, 0, ...c2], 'macro chunk 2');
eq(dev.sent[2].slice(0, 8), [240, 16, 165, 34, 0, 0, 0, 5], 'macro commit');
eq([dev.sent[0].length], [64], 'report body is 63 bytes');

assert(await kb.battery() === 77, 'battery reads byte 7 of report 48 reply');
eq(dev.sent.at(-1).slice(0, 10), [240, 48, 165, 11, 46, 1, 1, 1, 0, 0], 'battery request');

const silent = fakeDev({ reply: false });
const kb2 = await attach([silent], {});
let err = null; await kb2.setMouseConfig(cfg).catch((e) => (err = e));
assert(err && /No reply/.test(err.message), 'config write without ack fails loudly');
await kb2.setButtons([], []); assert(true, 'keys write tolerates no reply');
