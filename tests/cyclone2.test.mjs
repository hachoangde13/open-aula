// GameSir Cyclone 2 against an emulator loaded with a real controller's memory (factory backup) and
// checked against packets captured while a real controller was changed (tests/fixtures/cyclone2).
import fs from 'node:fs';
import path from 'node:path';

const W = process.argv[2];
const FIX = path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures/cyclone2');
const { attach } = await import(W + '/models/index.js');
const { GameSir } = await import(W + '/protocols/gamesir.js');
const assert = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) process.exitCode = 1; };
const hx = (a) => Array.from(a, (x) => x.toString(16).padStart(2, '0')).join(' ');
const fromHex = (s) => Uint8Array.from(s.match(/../g).map((h) => parseInt(h, 16)));

const baseline = JSON.parse(fs.readFileSync(path.join(FIX, 'baseline.json'), 'utf8'));
const capture = (name) => fs.readFileSync(path.join(FIX, name + '.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
// WriteProfile packets a capture sent, as "0f 03 bank offH offL n data…" strings.
const capWrites = (name) => capture(name).filter((e) => e.dir === 'out' && e.hex.startsWith('0f 03')).map((e) => {
  const h = e.hex.split(' '); return h.slice(0, 6 + parseInt(h[5], 16)).join(' ');
});
const replyOf = (name, first) => fromHex(capture(name).find((e) => e.dir === 'in' && e.hex.startsWith(first)).hex.replace(/ /g, ''));

function pad({ pid = 0x1053, dropAckOnce = false, loseWriteOnce = false } = {}) {
  const mem = Object.fromEntries(Object.entries(baseline).map(([k, v]) => [parseInt(k, 16), fromHex(v)]));
  const st = { profile: 1, writes: [], sent: [], times: [] };
  const ls = [];
  const fw = replyOf('30-dongle-info', '10 0a');
  const stream = replyOf('50-battery-dongle', '12 ');
  const dev = {
    vendorId: 0x3537, productId: pid, productName: pid === 0x100b ? 'GameSir-Cyclone 2' : 'Gamepad', opened: false, mem, st,
    collections: [
      { usagePage: 0x0001, usage: 6, outputReports: [{ reportId: 3 }] },
      { usagePage: 0xfff0, usage: 0x40, outputReports: [{ reportId: 0x0f }], inputReports: [{ reportId: 0x10 }, { reportId: 0x12 }] },
    ],
    async open() { this.opened = true; },
    addEventListener(_, f) { ls.push(f); },
    async sendReport(id, d) {
      if (id !== 0x0f || d.length !== 63) throw new Error(`bad report ${id} len ${d.length}`);
      st.sent.push(hx([0x0f, ...d])); st.times.push(performance.now());
      const emit = (rid, bytes) => setTimeout(() => ls.forEach((l) => l({ reportId: rid, data: new DataView(Uint8Array.from(bytes).buffer) })), 2);
      const r = new Uint8Array(63);
      const [op, a, oh, ol, n] = d;
      if (op === 0x0b) { r.set([0x0c, st.profile]); emit(0x10, r); }
      else if (op === 0x09) emit(0x10, fw.slice(1));
      else if (op === 0xf2) emit(0x12, stream.slice(1));
      else if (op === 0x07) { st.profile = a; r.set([0x06, 0]); emit(0x10, r); }
      else if (op === 0x04) { const off = (oh << 8) | ol; r.set([0x05, a, oh, ol, n, ...mem[a].slice(off, off + n)]); emit(0x10, r); }
      else if (op === 0x03) {
        if (loseWriteOnce && !st.lost) { st.lost = true; return; }
        mem[a].set(d.slice(5, 5 + n), (oh << 8) | ol); st.writes.push(hx([0x0f, ...d.slice(0, 5 + n)]));
        if (dropAckOnce && !st.dropped) { st.dropped = true; return; }
        r.set([0x06, 0]); emit(0x10, r);
      } else throw new Error('emulator: unexpected opcode ' + op.toString(16));
    },
  };
  return dev;
}

// --- discovery
const cable = pad();
const kb = await attach([cable], {});
assert(kb instanceof GameSir && kb.model.id === 'cyclone2' && kb.mode === 'usb', 'cable (3537:1053) attaches over the 0xFFF0 channel');
const dongleDev = pad({ pid: 0x100b });
const kd = await attach([dongleDev], {});
assert(kd?.mode === '2.4g', 'dongle (3537:100b) attaches as 2.4 GHz');
const ds4 = { ...pad(), vendorId: 0x054c, productId: 0x09cc };
assert((await attach([ds4], {}))?.model.id !== 'cyclone2', 'DS4 mode (054c:09cc) is not treated as configurable');

// --- reading the real factory memory
const c = await kb.readMouseConfig();
assert(c.profile === 1 && c.rate === 2 && c.vibrationLeft === 3 && c.vibrationRight === 3, `factory: profile 1, 1000 Hz, vibration level 3 (got ${c.rate}, ${c.vibrationLeft})`);
assert(c.leftDeadzone === 10 && c.rightDeadzone === 10 && c.ltDeadzone === 5 && c.rtDeadzone === 5 && !c.leftSquare && !c.ltHair, `factory: stick 10 %, trigger 5 %, round sticks, hair trigger off (got ${c.leftDeadzone}/${c.ltDeadzone})`);
assert(c.buttons.length === 18 && c.buttons.every((b) => b === null), 'factory: no button remapped (L4 macro left alone)');
assert(c.brightness === fromHex(baseline['0x20'])[1 + 124 * 3 + 3], `brightness read from the active effect (${c.brightness})`);

// --- every change must produce exactly the packets the reference CLI sent to the real controller
async function same(label, cap, fn, opts) {
  const d = pad(opts); const k = await attach([d], {});
  await fn(k);
  const want = capWrites(cap);
  assert(d.st.writes.join('|') === want.join('|'), `${label}: ${want.join(' + ') || '(no write)'}${d.st.writes.join('|') === want.join('|') ? '' : `  GOT ${d.st.writes.join(' + ')}`}`);
  return d;
}
await same('left stick deadzone 90', '15-cli-set-deadzone-left', (k) => k.setSettings({ leftDeadzone: 90 }));
await same('LT hair trigger adaptive', '19-cli-lt-hair', (k) => k.setSettings({ ltHair: 1 }));
{
  const d = pad(); const k = await attach([d], {});
  await k.setSettings({ ltHair: 1 }); await k.setSettings({ ltHair: 0 });
  assert(d.st.writes.join('|') === '0f 03 01 01 fa 01 81|0f 03 01 01 fa 01 00', 'LT hair trigger off again: 0f 03 01 01 fa 01 00 (as the CLI capture 20)');
}
await same('left stick square', '60-left-square', (k) => k.setSettings({ leftSquare: 1 }));
await same('vibration 100 %', '27-cli-vibration-4', (k) => k.setSettings({ vibrationLeft: 4, vibrationRight: 4 }));
await same('brightness 50', '12-cli-set-brightness', (k) => k.setSettings({ brightness: 50 }));
await same('A -> B', '21-cli-map-a-b', (k) => { const b = []; b[8] = { type: 'pad', code: 0x0a }; return k.setButtons(b); });
// R4 -> A: factory R4 already has map_en = 1, so only the code byte changes; compare the memory.
{
  const ref = pad(); for (const w of capWrites('41-r4-a')) { const h = w.split(' ').map((x) => parseInt(x, 16)); ref.mem[h[2]].set(h.slice(6), (h[3] << 8) | h[4]); }
  const d = pad(); const k = await attach([d], {});
  const b = []; b[17] = { type: 'pad', code: 0x09 }; await k.setButtons(b);
  assert(hx(d.mem[1]) === hx(ref.mem[1]), `R4 -> A: bank 1 ends byte-identical to the real capture (${d.st.writes.join()})`);
}
const lt = capWrites('17-cli-lt-deadzone')[0].split(' ');
await same(`LT deadzone ${parseInt(lt[6], 16)}`, '17-cli-lt-deadzone', (k) => k.setSettings({ ltDeadzone: parseInt(lt[6], 16) }));

// L4 -> B also clears the factory macro; packet split differs, so compare the resulting memory.
{
  const ref = pad(); for (const w of capWrites('42-l4-b')) { const h = w.split(' ').map((x) => parseInt(x, 16)); ref.mem[h[2]].set(h.slice(6), (h[3] << 8) | h[4]); }
  const d = pad(); const k = await attach([d], {});
  const b = []; b[16] = { type: 'pad', code: 0x0a }; await k.setButtons(b);
  assert(hx(d.mem[1]) === hx(ref.mem[1]), 'L4 -> B: bank 1 ends byte-identical to the real capture (macro cleared)');
  const back = await k.readMouseConfig();
  assert(JSON.stringify(back.buttons[16]) === JSON.stringify({ type: 'pad', code: 0x0a }), 'L4 -> B reads back as B');
  await k.setButtons(Object.assign([], { 16: null }));
  assert(d.mem[1][0x0b2] === 1 && d.mem[1][0x0b3] === 0x11, 'L4 back to default = map_en 1 + own code (factory encoding)');
}

// Round trip: writing back what was read changes nothing.
{
  const d = pad(); const k = await attach([d], {});
  const r = await k.readMouseConfig(); const { buttons, ...s } = r;
  await k.setSettings(s); await k.setButtons(buttons);
  assert(d.st.writes.length === 0, 'applying the settings just read writes nothing');
}

// Profile switch, as captured (0f 07 02), then settings land in bank 2.
{
  const d = pad(); const k = await attach([d], {});
  await k.setSettings({ profile: 2, leftDeadzone: 30 });
  assert(d.st.sent.some((s) => s.startsWith('0f 07 02 00')) && d.st.profile === 2, 'profile 2: 0f 07 02 sent and confirmed');
  assert(d.st.writes.join() === '0f 03 02 02 29 01 1e', 'deadzone written to bank 2 only');
}

// Firmware and battery from real replies.
assert(await kd.firmware() === '3.4.6 (dongle 1.2.0)', 'firmware from the real reply: 3.4.6 (dongle 1.2.0)');
assert(await kd.battery() === 100, 'battery from the real stream report: 100 %');

// Dongle: at least 20 ms between commands.
{
  const d = pad({ pid: 0x100b }); const k = await attach([d], {});
  await k.setSettings({ leftDeadzone: 40 });
  const gaps = d.st.times.slice(1).map((t, i) => t - d.st.times[i]);
  assert(Math.min(...gaps) >= 19.5, `dongle pacing: min gap ${Math.min(...gaps).toFixed(1)} ms`);
}

// Radio losses: a lost Ack is not resent; a lost write is resent once.
{
  const d = pad({ dropAckOnce: true }); const k = await attach([d], {});
  await k.setSettings({ leftDeadzone: 50 });
  assert(d.st.writes.length === 1 && d.mem[1][0x229] === 50, 'lost Ack: read-back sees the write, no resend');
  const e = pad({ loseWriteOnce: true }); const k2 = await attach([e], {});
  await k2.setSettings({ leftDeadzone: 60 });
  assert(e.st.writes.length === 1 && e.mem[1][0x229] === 60, 'lost write: resent once and landed');
}

// Allow-list: dangerous commands never leave the page.
const p = (...b) => { const x = new Uint8Array(63); x.set(b); return x; };
assert(![p(0x17, 0x55, 0x88), p(0xfc), p(0xfd, 1), p(0x03, 1, 0x02, 0xa0, 10), p(0x03, 0x30, 0, 0, 1, 2), p(0x07, 5), p(0x20, 0x66, 0x55, 1, 1)].some((x) => GameSir.allowed(x)),
  'firmware update, upgrade mode, calibration, out-of-bank writes, Shift switch and vibration test are refused');
let err = null; await kb.setButtons([{ type: 'key', code: 4 }]).catch((x) => (err = x));
assert(err && /not supported/.test(err.message), 'keyboard actions on the pad are rejected before any write');
