import { sleep, hex, Unsupported } from '../common.js';

// GameSir Cyclone 2, XInput mode (cable 3537:1053, 2.4 GHz dongle 3537:100b), vendor channel 0xFFF0.
// Commands go out as report 0x0F, replies come back as report 0x10, and a heartbeat makes the pad
// stream its state as report 0x12. Settings live in 680-byte profile banks (1-4, 5 = Shift layer)
// and a 635-byte light bank (0x20); writes put raw bytes at (bank, offset) with no checksum.
// Every offset used here comes from github.com/Yakuru-43/cyclone2-linux (MIT), which mapped them
// from GameSir Connect and confirmed them on a real controller. Only those fields are ever written,
// and only the bytes that change; firmware-update and device-ID commands are never sent.

export const REPORT = { OUT: 0x0f, REPLY: 0x10, STREAM: 0x12 };
export const USAGE_PAGE = 0xfff0;
export const OP = {
  WRITE: 0x03, READ: 0x04, READ_ACK: 0x05, ACK: 0x06, SWITCH: 0x07,
  FW: 0x09, FW_ACK: 0x0a, PROFILE: 0x0b, PROFILE_ACK: 0x0c, HEARTBEAT: 0xf2,
};
export const CHUNK = 58;
export const BANK_SIZE = { 1: 680, 2: 680, 3: 680, 4: 680, 5: 680, 0x20: 635 };
export const LIGHT_BANK = 0x20;

// Buttons with a 7-byte key block at 0x040 + 7i, then the two back buttons (159-byte blocks).
export const KEYS = ['Up', 'Down', 'Left', 'Right', 'LB', 'RB', 'LS', 'RS', 'A', 'B', 'X', 'Y', 'Home', 'View', 'Menu', 'Share'];
export const BACK = { L4: 0x0b0, R4: 0x14f };
const BACK_SELF = { L4: 0x11, R4: 0x12 };
// Gamepad output codes 0x01-0x1C (GameSir Connect's key table; B = 0x0A confirmed on the device).
export const TARGETS = [
  ...[...KEYS, 'L4', 'R4', 'LT', 'RT'].map((n, i) => [n, i + 1]),
  ['Left stick up', 0x15], ['Left stick down', 0x16], ['Left stick left', 0x17], ['Left stick right', 0x18],
  ['Right stick up', 0x19], ['Right stick down', 0x1a], ['Right stick left', 0x1b], ['Right stick right', 0x1c],
];
export const SLOTS = [...KEYS, 'L4', 'R4'];

// Profile fields (offsets inside a profile bank).
const F = {
  MOTOR_L: 0x020, MOTOR_R: 0x021, RATE: 0x02e,
  LT: 0x1ee, RT: 0x20a, LSTICK: 0x226, RSTICK: 0x246,
};
export const MOTOR_RAW = [0, 25, 50, 75, 100]; // levels 0-4
const HAIR = { off: 0x00, adaptive: 0x81 };
const activeBrightness = (light) => 1 + 124 * (light[0] <= 3 ? light[0] : 0) + 3;

const keyBase = (slot) => (slot < 16 ? 0x040 + 7 * slot : BACK[SLOTS[slot]]);

// What a button does now, as an app action; null = its normal function (or a macro, left alone).
export function decodeButton(bank, slot) {
  const b = keyBase(slot);
  const en = bank[b + 2], code = bank[b + 3];
  if (slot >= 16) {
    const macro = bank[b + 7] & 1;
    if (macro || !en || code === BACK_SELF[SLOTS[slot]]) return null;
  } else if (!en) return null;
  return TARGETS.some(([, c]) => c === code) ? { type: 'pad', code } : null;
}

export function applyButtons(bank, buttons) {
  SLOTS.forEach((name, slot) => {
    const a = buttons?.[slot];
    if (a === undefined) return;
    const b = keyBase(slot);
    if (a === null || a.type === 'default') {
      // Only touch it if it is remapped now; a factory macro on L4/R4 stays.
      if (decodeButton(bank, slot) === null) return;
      if (slot < 16) { bank[b + 2] = 0; bank[b + 3] = 0; } else { bank[b + 2] = 1; bank[b + 3] = BACK_SELF[name]; }
      return;
    }
    if (a.type !== 'pad' || !TARGETS.some(([, c]) => c === a.code)) throw new Unsupported(`Button action "${a.type}"`);
    if (slot >= 16) {
      // Picking a button clears the back button's macro, as GameSir Connect does.
      bank[b + 7] &= ~1;
      bank.fill(0, b + 10, b + 159);
    }
    bank[b + 2] = 1; bank[b + 3] = a.code;
  });
  return bank;
}

export function decodeSettings(bank, light, profile) {
  const lvl = (raw) => Math.max(0, MOTOR_RAW.findIndex((r) => r >= raw));
  return {
    profile,
    rate: bank[F.RATE] <= 2 ? bank[F.RATE] : 2,
    vibrationLeft: lvl(bank[F.MOTOR_L]), vibrationRight: lvl(bank[F.MOTOR_R]),
    leftDeadzone: bank[F.LSTICK + 3], rightDeadzone: bank[F.RSTICK + 3],
    leftSquare: bank[F.LSTICK + 1] ? 1 : 0, rightSquare: bank[F.RSTICK + 1] ? 1 : 0,
    ltDeadzone: bank[F.LT + 3], rtDeadzone: bank[F.RT + 3],
    ltHair: bank[F.LT + 12] & 0x80 ? 1 : 0, rtHair: bank[F.RT + 12] & 0x80 ? 1 : 0,
    brightness: light ? light[activeBrightness(light)] : 0,
  };
}

const pct = (v) => Math.max(0, Math.min(100, v | 0));
export function applySettings(bank, s) {
  if (s.rate != null) bank[F.RATE] = Math.max(0, Math.min(2, s.rate | 0));
  if (s.vibrationLeft != null) bank[F.MOTOR_L] = MOTOR_RAW[Math.max(0, Math.min(4, s.vibrationLeft | 0))];
  if (s.vibrationRight != null) bank[F.MOTOR_R] = MOTOR_RAW[Math.max(0, Math.min(4, s.vibrationRight | 0))];
  if (s.leftDeadzone != null) bank[F.LSTICK + 3] = pct(s.leftDeadzone);
  if (s.rightDeadzone != null) bank[F.RSTICK + 3] = pct(s.rightDeadzone);
  if (s.leftSquare != null) bank[F.LSTICK + 1] = s.leftSquare ? 1 : 0;
  if (s.rightSquare != null) bank[F.RSTICK + 1] = s.rightSquare ? 1 : 0;
  if (s.ltDeadzone != null) bank[F.LT + 3] = pct(s.ltDeadzone);
  if (s.rtDeadzone != null) bank[F.RT + 3] = pct(s.rtDeadzone);
  // Factory pads store 0x01 (off, mode 1 remembered): only write when the on/off state changes.
  for (const [k, base] of [['ltHair', F.LT], ['rtHair', F.RT]]) {
    if (s[k] == null || !!s[k] === !!(bank[base + 12] & 0x80)) continue;
    bank[base + 12] = s[k] ? HAIR.adaptive : HAIR.off;
  }
  return bank;
}

// Changed byte ranges as write chunks (runs closer than `gap` bytes merge; at most 58 bytes each).
export function diffWrites(cur, next, gap = 4) {
  const out = [];
  let i = 0;
  while (i < next.length) {
    if (cur[i] === next[i]) { i++; continue; }
    let j = i, same = 0;
    while (j < next.length && same < gap) { same = cur[j] === next[j] ? same + 1 : 0; j++; }
    const end = j - same;
    for (let o = i; o < end; o += CHUNK) out.push([o, next.slice(o, Math.min(end, o + CHUNK))]);
    i = j;
  }
  return out;
}

export function parseFirmware(r) {
  const text = (a) => String.fromCharCode(...Array.from(a).filter((_, k) => k % 2 === 0).filter((c) => c && c !== 0x20));
  const ver = (t) => (t.length > 1 ? t.slice(1).split('').join('.') : null);
  return { controller: ver(text(r.subarray(1, 9))), dongle: ver(text(r.subarray(9, 17))) };
}

export class GameSir {
  static async discover(devices, model) {
    for (const d of devices) {
      const role = model.usb.find((u) => u.vendorId === d.vendorId && u.productId === d.productId)?.role;
      const ok = d.collections.some((c) => c.usagePage === USAGE_PAGE && c.outputReports?.some((r) => r.reportId === REPORT.OUT));
      if (!role || !ok) continue;
      if (!d.opened) await d.open();
      return { [role === 'dongle' ? 'dongle' : 'main']: { dev: d, reportId: REPORT.OUT } };
    }
    return null;
  }

  constructor({ main, dongle } = {}, model, { log = () => {} } = {}) {
    this.model = model;
    this.main = main;
    this.dongle = dongle;
    this.link = main ?? dongle;
    this.log = log;
    this.busy = Promise.resolve();
    this.waiter = null;
    this.last = 0;
    // Through the dongle a command sent right after the previous reply is dropped: keep 20 ms gaps.
    this.gap = dongle ? 20 : 0;
    if (this.link) {
      this.link.dev.addEventListener('inputreport', (e) => {
        const r = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength).slice();
        if (this.waiter?.(e.reportId, r)) this.waiter = null;
      });
    }
  }

  get mode() { return this.main ? 'usb' : this.dongle ? '2.4g' : 'sim'; }
  get name() { return this.link?.dev.productName || 'Simulator'; }

  exclusive(fn) {
    const run = this.busy.then(fn, fn);
    this.busy = run.catch(() => {});
    return run;
  }

  // Only these packets can leave the page (same allow-list idea as the reference driver).
  static allowed(p) {
    const [op, bank, oh, ol, n] = p;
    const inBank = () => BANK_SIZE[bank] && n >= 1 && n <= CHUNK && ((oh << 8) | ol) + n <= BANK_SIZE[bank];
    if (op === OP.FW || op === OP.PROFILE) return p.subarray(1).every((x) => !x);
    if (op === OP.HEARTBEAT) return p.subarray(1).every((x) => !x);
    if (op === OP.READ) return inBank() && p.subarray(5).every((x) => !x);
    if (op === OP.SWITCH) return bank >= 1 && bank <= 4 && p.subarray(2).every((x) => !x);
    if (op === OP.WRITE) {
      const off = (oh << 8) | ol;
      return inBank() && !(off <= 0x3a3 && off + n > 0x39d) && p.subarray(5 + n).every((x) => !x);
    }
    return false;
  }

  async send(payload) {
    const p = new Uint8Array(63);
    p.set(payload);
    if (!GameSir.allowed(p)) throw new Error(`Refused to send ${hex(p.subarray(0, 8))}`);
    const wait = this.last + this.gap - performance.now();
    if (wait > 0) await sleep(wait);
    this.log('→', `0f ${hex(p.subarray(0, 6 + (p[0] === OP.WRITE ? p[4] : 0)))}`);
    this.last = performance.now();
    await this.link.dev.sendReport(REPORT.OUT, p);
    return p;
  }

  // Send and wait for the reply report 0x10 whose first byte is `op` (and that `match` accepts).
  async transact(payload, op, { match = () => true, retries = 0, timeout = 1000 } = {}) {
    for (let attempt = 0; ; attempt++) {
      const reply = new Promise((resolve) => {
        const t = setTimeout(() => { this.waiter = null; resolve(null); }, timeout);
        this.waiter = (id, r) => {
          if (id !== REPORT.REPLY) return false;
          if (r[0] === OP.ACK && r[1] === 1) return false; // busy, keep waiting
          if (r[0] !== op || !match(r)) return false;
          clearTimeout(t); resolve(r); return true;
        };
      });
      await this.send(payload);
      const r = await reply;
      if (r) {
        this.last = performance.now();
        this.log('←', hex(r.subarray(0, 24)));
        return r;
      }
      if (attempt >= retries) throw new Error(`No reply to command 0x${payload[0].toString(16)}`);
    }
  }

  async read(bank, off, n) {
    const r = await this.transact([OP.READ, bank, off >> 8, off & 0xff, n], OP.READ_ACK,
      { retries: 2, match: (x) => x[1] === bank && ((x[2] << 8) | x[3]) === off && x[4] === n });
    return r.slice(5, 5 + n);
  }

  async readBank(bank) {
    const out = new Uint8Array(BANK_SIZE[bank]);
    for (let off = 0; off < out.length; off += CHUNK) out.set(await this.read(bank, off, Math.min(CHUNK, out.length - off)), off);
    return out;
  }

  // Write, then read the bytes back. A lost Ack (radio drop) is checked by the read-back.
  async write(bank, off, data) {
    const same = (a) => a.length === data.length && a.every((x, i) => x === data[i]);
    for (let attempt = 1; ; attempt++) {
      const ok = await this.transact([OP.WRITE, bank, off >> 8, off & 0xff, data.length, ...data], OP.ACK).then(() => true, () => false);
      const back = await this.read(bank, off, data.length);
      if (same(back)) return;
      if (ok || attempt === 2) throw new Error(`Write at bank 0x${bank.toString(16)} +0x${off.toString(16)} did not take`);
    }
  }

  async writeDiff(bank, cur, next) {
    for (const [off, data] of diffWrites(cur, next)) await this.write(bank, off, Array.from(data));
  }

  async currentProfile() {
    const r = await this.transact([OP.PROFILE], OP.PROFILE_ACK, { retries: 2 });
    return r[1] >= 1 && r[1] <= 5 ? r[1] : 1;
  }

  async switchProfile(n) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      await this.transact([OP.SWITCH, n], OP.ACK).catch(() => null);
      if ((await this.currentProfile()) === n) return;
    }
    throw new Error(`The controller did not switch to profile ${n}`);
  }

  readMouseConfig() {
    return this.exclusive(async () => {
      if (!this.link) return null;
      const profile = await this.currentProfile();
      const bank = await this.readBank(profile);
      const light = await this.readBank(LIGHT_BANK);
      return { ...decodeSettings(bank, light, profile), buttons: SLOTS.map((_, i) => decodeButton(bank, i)) };
    });
  }

  setSettings(s) {
    return this.exclusive(async () => {
      if (!this.link) { this.log('⚙', 'Simulated Cyclone 2 settings write'); return; }
      let profile = await this.currentProfile();
      const want = s.profile | 0;
      if (want >= 1 && want <= 4 && want !== profile) { await this.switchProfile(want); profile = want; }
      const bank = await this.readBank(profile);
      await this.writeDiff(profile, bank, applySettings(bank.slice(), s));
      if (s.brightness != null) {
        const light = await this.readBank(LIGHT_BANK);
        const next = light.slice();
        next[activeBrightness(light)] = pct(s.brightness);
        await this.writeDiff(LIGHT_BANK, light, next);
      }
    });
  }

  setButtons(buttons) {
    return this.exclusive(async () => {
      applyButtons(new Uint8Array(680), buttons); // reject unsupported actions before touching the pad
      if (!this.link) { this.log('⚙', 'Simulated Cyclone 2 button write'); return; }
      const profile = await this.currentProfile();
      const bank = await this.readBank(profile);
      await this.writeDiff(profile, bank, applyButtons(bank.slice(), buttons));
    });
  }

  firmware() {
    return this.exclusive(async () => {
      const v = parseFirmware(await this.transact([OP.FW], OP.FW_ACK, { retries: 2 }));
      return v.dongle ? `${v.controller} (dongle ${v.dongle})` : v.controller;
    });
  }

  // A heartbeat makes the pad stream report 0x12 for about a second: byte 35 is the battery level.
  battery() {
    return this.exclusive(async () => {
      if (!this.link) return null;
      const got = new Promise((resolve) => {
        const t = setTimeout(() => { this.waiter = null; resolve(null); }, 1500);
        this.waiter = (id, r) => { if (id !== REPORT.STREAM || r.length < 36) return false; clearTimeout(t); resolve(r); return true; };
      });
      await this.send([OP.HEARTBEAT, 0]);
      const r = await got;
      return r ? Math.min(100, r[35]) : null;
    });
  }

  setLighting() { return Promise.reject(new Unsupported('Lighting effects (use Brightness in Settings)')); }
  setMouseConfig() { return Promise.reject(new Unsupported('DPI')); }
  setMacros() { return Promise.reject(new Unsupported('Macros')); }
  setKeymap() { return Promise.reject(new Unsupported('Keyboard keymap')); }
  setUserLight() { return Promise.reject(new Unsupported('Per-key lighting')); }
  readUserLight() { return Promise.reject(new Unsupported('Per-key lighting')); }
  setBarLight() { return Promise.reject(new Unsupported('Bar light')); }
  setMatrixEffect() { return Promise.reject(new Unsupported('LED matrix')); }
  uploadScreen() { return Promise.reject(new Unsupported('Screen upload')); }
  syncTime() { return Promise.reject(new Unsupported('Clock sync')); }
  resetKeys() { return Promise.reject(new Unsupported('Reset')); }
  factoryReset() { return Promise.reject(new Unsupported('Reset')); }
}
