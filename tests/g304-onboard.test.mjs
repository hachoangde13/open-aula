const W = process.argv[2];
const { HidPP, crc16, crcOk, sealCrc } = await import(W + '/protocols/hidpp.js');
const { attach } = await import(W + '/models/index.js');
const assert = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) process.exitCode = 1; };
assert(crc16(new TextEncoder().encode('123456789')) === 0x29b1, 'CRC-16/CCITT-FALSE check value 0x29B1');

const SIZE = 255;
function fakeMouse({ current = 0x0101, romCrc = true, dirError = false } = {}) {
  const FEATS = { 0x2201: 5, 0x8060: 6, 0x8100: 7, 0x1000: 3 };
  const mem = new Map();
  const rom = new Uint8Array(SIZE).fill(0xff);
  rom.set([1, 1, 0, 0x90, 0x01, 0x20, 0x03, 0x40, 0x06, 0x80, 0x0c, 0xe0, 0x2e], 0); // 1 ms, dpi 400/800/1600/3200/12000
  [[0x80,1,0,1],[0x80,1,0,2],[0x80,1,0,4],[0x80,1,0,8],[0x80,1,0,0x10],[0x90,5,0,0]].forEach((b, i) => rom.set(b, 32 + i * 4));
  rom.set([0x00, 0x00, 0x00], 208); // pretend LED data that must survive
  mem.set(0x0101, sealCrc(rom)); if (!romCrc) { rom[SIZE - 1] ^= 0x55; }
  if (current === 1) mem.set(1, sealCrc(rom.slice()));
  const dir = new Uint8Array(SIZE).fill(0xff); if (current === 1) dir.set([0, 1, 1, 0, 0xff, 0xff, 0, 0]); mem.set(0, current === 1 ? sealCrc(dir) : dir);
  const st = { mode: 1, current, writes: [] }; let w = null;
  const listeners = [];
  const dev = { vendorId: 0x046d, productId: 0xc539, productName: 'USB Receiver', opened: true, st, mem,
    collections: [{ usagePage: 0xff00, usage: 2, outputReports: [{ reportId: 0x11 }] }],
    async open() {}, addEventListener(_, f) { listeners.push(f); },
    async sendReport(id, d) {
      const [ix, fi, fs] = d; const fn = fs >> 4; const p = d.slice(3);
      let r = new Uint8Array(19); r.set(d.slice(0, 3));
      if (ix !== 1) r = new Uint8Array([ix, 0x8f, fi, fs, 9, 0, 0]);
      else if (fi === 0 && fn === 1) { r[3] = 4; }
      else if (fi === 0 && fn === 0) r[3] = FEATS[(p[0] << 8) | p[1]] ?? 0;
      else if (fi === 7) {
        if (fn === 0) r.set([1, 1, 1, 1, 0, 6, 16, 0, SIZE], 3);
        if (fn === 1) st.mode = p[0];
        if (fn === 3) st.current = (p[0] << 8) | p[1];
        if (fn === 4) r.set([st.current >> 8, st.current & 255], 3);
        if (fn === 5 && dirError && ((p[0] << 8) | p[1]) === 0 && !st.writes.includes(0)) r = new Uint8Array([ix, 0xff, fi, fs, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        else if (fn === 5) { const s = mem.get((p[0] << 8) | p[1]) ?? new Uint8Array(SIZE).fill(0xff); r.set(s.subarray((p[2] << 8) | p[3], ((p[2] << 8) | p[3]) + 16), 3); }
        if (fn === 6) w = { sector: (p[0] << 8) | p[1], len: (p[4] << 8) | p[5], buf: [] };
        if (fn === 7) w.buf.push(...p.slice(0, 16));
        if (fn === 8) { if (w.sector >= 0x100) throw new Error('wrote ROM'); mem.set(w.sector, Uint8Array.from(w.buf.slice(0, w.len))); st.writes.push(w.sector); }
      }
      setTimeout(() => listeners.forEach((l) => l({ reportId: r.length === 7 ? 0x10 : 0x11, data: new DataView(r.buffer) })), 1);
    } };
  return dev;
}

for (const [start, opts, tag] of [[0x0101, {}, 'ROM profile'], [1, {}, 'user profile'], [0x0101, { romCrc: false, dirError: true }, 'factory G305: ROM without CRC, unreadable directory'], [0, {}, 'no active profile']]) {
  const dev = fakeMouse({ current: start, ...opts });
  const kb = await attach([dev], {});
  await kb.setButtons([null, { type: 'key', code: 0x19, mods: 0x01 }, { type: 'media', usage: 0xcd }, { type: 'disable' }, { type: 'mouse', id: 3 }, { type: 'dpiLoop' }]);
  await kb.setMouseConfig({ dpi: [400, 800, 1600, 3200, 6400], dpiIndex: 3, rate: 2 });
  const p = dev.mem.get(1);
  const label = `[${tag}]`;
  assert(dev.st.writes.every((s) => s < 0x100), `${label} ROM untouched`);
  assert(Array.from(dev.mem.get(0).subarray(0, 8)).join(',') === '0,1,1,0,255,255,0,0', `${label} directory matches libratbag layout`);
  assert(p && p.length === SIZE && crcOk(p), `${label} user sector 1 written with valid CRC`);
  assert(crcOk(dev.mem.get(0)) && dev.mem.get(0)[0] === 0 && dev.mem.get(0)[1] === 1 && dev.mem.get(0)[2] === 1, `${label} directory enables sector 1`);
  const btn = (i) => Array.from(p.subarray(32 + i * 4, 36 + i * 4)).join(',');
  assert(btn(0) === '128,1,0,1', `${label} left untouched`);
  assert(btn(1) === '128,2,1,25' && btn(2) === '128,3,0,205' && btn(3) === '255,0,0,0' && btn(4) === '128,1,0,2' && btn(5) === '144,5,0,0', `${label} buttons encoded`);
  assert(p[0] === 4 && p[1] === 3 && p[3] === 0x90 && p[4] === 1 && p[11] === 0x00 && p[12] === 0x19, `${label} rate 4 ms, default dpi idx 3, dpi LE`);
  assert(p[208] === 0 && p[100] === 0xff, `${label} other bytes preserved`);
  assert(dev.st.mode === 1 && dev.st.current === 1, `${label} onboard mode, profile 1 active`);
}
const kb = await attach([fakeMouse()], {});
let e = null; await kb.setButtons([null, { type: 'macro', index: 0 }]).catch((x) => (e = x));
assert(e && /not supported/.test(e.message), 'macro on button rejected before any write');
const bad = fakeMouse({ current: 1 }); bad.mem.get(1)[5] ^= 1; const kb2 = await attach([bad], {});
e = null; await kb2.setMouseConfig({ dpi: [800], dpiIndex: 0, rate: 4 }).catch((x) => (e = x));
assert(e && /unexpected format/.test(e.message) && bad.st.writes.length === 0, 'bad CRC -> refuses to write');
const junk = fakeMouse(); junk.mem.get(0x0101)[0] = 0x77; const kb3 = await attach([junk], {});
e = null; await kb3.setButtons([null, { type: 'disable' }]).catch((x) => (e = x));
assert(e && /unexpected format/.test(e.message) && junk.st.writes.length === 0, 'implausible ROM profile -> refuses to write');
// libratbag's CRC routine, ported verbatim, must agree with ours
const ref = (d) => { let crc = 0xffff; for (const b of d) { const t = ((crc >> 8) ^ b) & 0xff; crc = (crc << 8) & 0xffff; let q = t ^ (t >> 4); crc ^= q; q = (q << 5) & 0xffff; crc ^= q; q = (q << 7) & 0xffff; crc ^= q; } return crc & 0xffff; };
const rnd = Uint8Array.from({ length: 253 }, (_, i) => (i * 37 + 11) & 255);
assert(ref(rnd) === crc16(rnd), 'CRC equals libratbag hidpp_crc_ccitt');
