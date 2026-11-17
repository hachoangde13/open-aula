const W = process.argv[2];
const { attach } = await import(W + '/models/index.js');
const assert = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) process.exitCode = 1; };
function dev(vendorId, productId, colls, respond) {
  const ls = [];
  return { vendorId, productId, productName: 'x', opened: true, collections: colls, async open() {}, addEventListener(_, f) { ls.push(f); },
    async sendReport(id, d) { const r = respond(id, d); if (r) setTimeout(() => ls.forEach((l) => l({ reportId: r.id, data: new DataView(r.data.buffer) })), 1); } };
}
// M3: version reply measured on a real mouse: 04 7a 2e 32 2e 31 2e 33
const m3 = dev(0xa8a5, 0x1, [{ usagePage: 0xff01, usage: 0x10, outputReports: [{ reportId: 0xf0 }] }], (id, d) => {
  const r = new Uint8Array(63); if (d[0] === 4) r.set([0x04, 0x7a, 0x2e, 0x32, 0x2e, 0x31, 0x2e, 0x33]); else r[0] = d[0]; return { id: 0xf0, data: r };
});
const k1 = await attach([m3], {});
assert(await k1.firmware() === '2.1.3', 'M3 firmware 2.1.3 from the measured reply');
// G304: feature 0x0003 at index 2, entity 0 = bootloader, entity 1 = main app "MPM" 19.02 build 0x0012
const g = dev(0x046d, 0xc539, [{ usagePage: 0xff00, usage: 2, outputReports: [{ reportId: 0x11 }] }], (id, d) => {
  const r = new Uint8Array(19); r.set(d.slice(0, 3)); const fn = d[2] >> 4;
  if (d[0] !== 1) return { id: 0x10, data: new Uint8Array([d[0], 0x8f, d[1], d[2], 9, 0, 0]) };
  if (d[1] === 0 && fn === 1) r[3] = 4;
  else if (d[1] === 0 && fn === 0) r[3] = { 0x0003: 2, 0x2201: 5 }[(d[3] << 8) | d[4]] ?? 0;
  else if (d[1] === 2 && fn === 0) r[3] = 2;
  else if (d[1] === 2 && fn === 1) r.set(d[3] === 0 ? [1, 0x42, 0x4f, 0x54, 0x01, 0x00, 0, 5] : [0, 0x4d, 0x50, 0x4d, 0x19, 0x02, 0x00, 0x12], 3);
  return { id: 0x11, data: r };
});
const k2 = await attach([g], {});
assert(await k2.firmware() === 'MPM 19.02.B0012', 'G304 main firmware formatted like Solaar');
