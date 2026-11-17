import { sleep, hex, Unsupported } from '../common.js';
import { Mouse55, encodeButton, DEFAULT_BUTTONS } from './mouse55.js';

// SMAILWOLF M3 Pro / M3 Pro+ (PAW3311). Same command set and data blocks as the SC620's `mouse55`
// family, but framed differently: the command goes out as report 0xF0 with no 0x55 lead byte, and
// replies start with the command byte instead of 0xAA. Byte layouts follow the MIT-licensed
// community driver github.com/duyzoz/Smail-Wolf-M3-Pro, which measured them on a real M3 Pro
// (firmware 2.1.3); header bytes are copied verbatim from its proven commands.

export const REPORT_ID = 0xf0;
export const USAGE = { usagePage: 0xff01, usage: 0x10 };
export const CMD = { KEYS: 0x09, MACRO: 0x0d, CONFIG: 0x0f, COMMIT: 0x10, BATTERY: 0x30 };

export const BUTTON_SLOTS = [
  { slot: 0, name: 'Left click', x: 0, y: 0, locked: true },
  { slot: 1, name: 'Right click', x: 0, y: 0 },
  { slot: 2, name: 'Wheel click', x: 0, y: 0 },
  { slot: 3, name: 'Back (side)', x: 0, y: 0 },
  { slot: 4, name: 'Forward (side)', x: 0, y: 0 },
  { slot: 5, name: 'DPI button', x: 0, y: 0 },
  { slot: 6, name: 'Scroll up', x: 0, y: 0 },
  { slot: 7, name: 'Scroll down', x: 0, y: 0 },
];
export const MACRO_PLAY = ['Repeat N times', 'Repeat until released', 'Repeat until any click'];

// 63-byte report body: [cmd, flag, sum, len, ...]. The vendor app sends fixed header bytes.
function frame(head, data = [], at = head.length) {
  const p = new Uint8Array(63);
  p.set(head);
  p.set(data, at);
  return p;
}

// Slots 0-4 are the buttons, 5 = DPI, 6/7 = wheel up/down; the rest of the 44-byte block is zero.
// The vendor app never remaps slots 5-7; the SC620 (same family) accepts them.
export function keysBlock(buttons) {
  const b = new Uint8Array(44);
  for (let i = 0; i < 8; i++) {
    const own = encodeButton(buttons?.[i]);
    b.set(own ?? DEFAULT_BUTTONS[i], i * 4);
  }
  return b;
}

export function configBlock(m) {
  const b = new Uint8Array(47);
  b[0] = 0; // profile
  b[1] = 0; // light mode: the vendor app has no lighting control
  b[2] = m.rate;
  b[3] = m.dpi.length;
  b[4] = m.dpiIndex + 1;
  m.dpi.forEach((v, i) => {
    const d = Math.max(50, Math.min(26000, v | 0));
    b[5 + i * 2] = d & 0xff; b[6 + i * 2] = d >> 8;
  });
  b[40] = m.scrollReverse ? 1 : 0;
  b[41] = m.liftoff;
  b[42] = m.angleSnap ? 1 : 0; // bit 0: line correction
  b[43] = m.debounce;
  b[44] = m.sleep;
  b[45] = m.esports ? 1 : 0;
  b[46] = 0; // wake-up / move-light nibbles, 0 on the measured mouse
  return b;
}

// Macro table + records as the vendor app compiles them (offsets start after a 4-byte header).
export function macroBlock(macros) {
  const table = new Uint8Array(64);
  const body = [];
  macros.slice(0, 32).forEach((m, i) => {
    const ev = [];
    for (const s of m.steps ?? []) {
      if (s.kind === 'delay') {
        if (ev.length) ev[ev.length - 1].delay += s.ms | 0;
        continue;
      }
      const down = s.kind.endsWith('DOWN') ? 0x40 : 0;
      if (s.kind.startsWith('MOUSE')) ev.push({ delay: 0, flag: 3 | down, code: s.code });
      else if (s.code >= 0xe0 && s.code <= 0xe7) ev.push({ delay: 0, flag: 1 | down, code: 1 << (s.code & 15) });
      else ev.push({ delay: 0, flag: 2 | down, code: s.code });
    }
    if (!ev.length) {
      table[i * 2] = 64;
      return;
    }
    const off = 68 + body.length;
    table[i * 2] = off & 0xff; table[i * 2 + 1] = off >> 8;
    ev[ev.length - 1].flag |= 0x80;
    for (const e of ev) {
      const d = Math.min(0xffff, e.delay || 2);
      body.push(d & 0xff, d >> 8, e.flag, e.code);
    }
  });
  return Uint8Array.from([...table, 0, 0, 0x80, 0, ...body]);
}

// Reply checksum: byte 2 = sum of bytes 3.. (mod 256), proven on the measured replies.
export const replyOk = (r) => r.subarray(3).reduce((a, b) => a + b, 0) % 256 === r[2];

// 4-byte binding -> app button action; null when it is the slot's default (or not understood).
export function decodeButton(b, slot) {
  const [t, a, c, d] = b;
  const def = DEFAULT_BUTTONS[slot];
  if (def && def.every((x, i) => x === b[i])) return null;
  if (t === 0x00 || (t === 0x10 && !a && !c)) return { type: 'disable' };
  if (t === 0x20) {
    const id = c === 0x02 && a === 0x01 ? 4 : { 0x01: 1, 0x04: 2, 0x02: 3, 0x08: 7, 0x10: 8 }[a];
    return id ? { type: 'mouse', id } : null;
  }
  if (t === 0x21 && a === 0x38) return { type: 'mouse', id: c === 0x01 ? 5 : 6 };
  if (t === 0x21 && a === 0x55) return { type: 'dpiLoop' };
  if (t === 0x10) return { type: 'key', mods: a, code: c };
  if (t === 0x30) return { type: 'media', usage: a | (c << 8) };
  if (t === 0x70) return { type: 'macro', index: a, mode: d === 2 ? 1 : d === 3 ? 2 : 0, loops: d ? 1 : c };
  return null;
}

// Config read reply (command 0x0e) -> the fields setMouseConfig() takes; null when the mouse answers empty.
export function parseConfig(r) {
  if ([13, 14, 15].every((i) => r[i] === 0) || [13, 14, 15].every((i) => r[i] === 0xff)) return null;
  const count = Math.max(1, Math.min(6, r[10]));
  return {
    rate: r[9],
    dpi: Array.from({ length: count }, (_, i) => Math.max(50, Math.min(26000, r[12 + i * 2] | (r[13 + i * 2] << 8)))),
    dpiIndex: Math.max(0, Math.min(count - 1, r[11] - 1)),
    scrollReverse: r[47] ? 1 : 0, liftoff: r[48], angleSnap: r[49] & 1, debounce: r[50], sleep: r[51], esports: r[52] ? 1 : 0,
  };
}

export class SmailM3 extends Mouse55 {
  static async discover(devices, model) {
    for (const d of devices) {
      const role = model.usb.find((u) => u.vendorId === d.vendorId)?.role;
      // The vendor app picks the 0xFF01/0x10 collection and writes report 0xF0; the report may be
      // declared in another collection of the same interface.
      const vendor = d.collections.some((c) => c.usagePage === USAGE.usagePage && c.usage === USAGE.usage);
      const report = d.collections.some((c) => c.outputReports?.some((r) => r.reportId === REPORT_ID));
      if (!role || !vendor || !report) continue;
      if (!d.opened) await d.open();
      return { [role === 'dongle' ? 'dongle' : 'main']: { dev: d, reportId: REPORT_ID } };
    }
    return null;
  }

  // One command at a time; the reply's first byte echoes the command. Some commands do not answer.
  async xfer(p, { need = false } = {}) {
    this.log('→', `${REPORT_ID.toString(16)} ${hex(p)}`);
    if (!this.link) { await sleep(1); return null; }
    this.q.flush();
    await this.link.dev.sendReport(REPORT_ID, p);
    const deadline = performance.now() + 500;
    while (performance.now() < deadline) {
      const r = await this.q.next(deadline - performance.now());
      if (!r) break;
      if (r[0] === p[0]) {
        this.log('←', hex(r));
        return r;
      }
    }
    if (need) throw new Error(`No reply to command 0x${p[0].toString(16)}`);
    return null;
  }

  setLighting() { return Promise.reject(new Unsupported('Lighting')); }

  setMouseConfig(m) {
    return this.exclusive(() => this.xfer(frame([CMD.CONFIG, 0xae, 0x0a, 0x2f, 1, 1, 1], configBlock(m), 7), { need: true }));
  }

  setButtons(buttons, macros) {
    return this.exclusive(async () => {
      if (buttons.some((b) => b?.type === 'macro')) await this.writeMacros(macros);
      await this.xfer(frame([CMD.KEYS, 0xa5, 0x22, 0x2c, 0, 0, 0], keysBlock(buttons), 7));
    });
  }

  async writeMacros(macros) {
    const data = macroBlock(macros);
    for (let off = 0; off < data.length; off += 56) {
      const part = data.slice(off, off + 56);
      const head = [part.length, off & 0xff, off >> 8, 0];
      const sum = [...head, ...part].reduce((s, x) => s + x, 0) & 0xff;
      await this.xfer(frame([CMD.MACRO, 0, sum, ...head], part, 7));
    }
    await this.xfer(frame([CMD.COMMIT, 0xa5, 0x22, 0, 0, 0, 5]));
  }

  // Read what the mouse holds now: settings, DPI stages and button bindings.
  readMouseConfig() {
    return this.exclusive(async () => {
      const k = await this.xfer(frame([0x08, 0xa5, 0x0b, 0x2c]), { need: true });
      const c = await this.xfer(frame([0x0e, 0xa5, 0x0b, 0x2e, 1, 1, 1]), { need: true });
      if (!replyOk(c) || !replyOk(k)) throw new Error('Reply checksum mismatch');
      const cfg = parseConfig(c);
      if (!cfg) throw new Error('The mouse returned an empty configuration');
      const buttons = [];
      for (let i = 0; i < 8; i++) buttons[i] = decodeButton(k.subarray(7 + i * 4, 11 + i * 4), i);
      return { ...cfg, buttons };
    });
  }

  // Version reply: the last five non-zero bytes are ASCII, e.g. "2.1.3".
  firmware() {
    return this.exclusive(async () => {
      const r = await this.xfer(frame([0x04]), { need: true });
      return String.fromCharCode(...Array.from(r).filter((b) => b).slice(-5));
    });
  }

  battery() {
    return this.exclusive(async () => {
      const r = await this.xfer(frame([CMD.BATTERY, 0xa5, 0x0b, 0x2e, 1, 1, 1])).catch(() => null);
      return r ? Math.min(100, r[7]) : null;
    });
  }
}
