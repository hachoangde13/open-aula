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
];
export const MACRO_PLAY = ['Repeat N times', 'Repeat until released', 'Repeat until any click'];

// 63-byte report body: [cmd, flag, sum, len, ...]. The vendor app sends fixed header bytes.
function frame(head, data = [], at = head.length) {
  const p = new Uint8Array(63);
  p.set(head);
  p.set(data, at);
  return p;
}

// Slots 0-4 are user buttons, 5 = DPI (fixed), 6/7 = wheel up/down; the rest of the 44-byte block is zero.
export function keysBlock(buttons) {
  const b = new Uint8Array(44);
  for (let i = 0; i < 8; i++) {
    const own = i < 5 ? encodeButton(buttons?.[i]) : null;
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

export class SmailM3 extends Mouse55 {
  static async discover(devices, model) {
    for (const d of devices) {
      const role = model.usb.find((u) => u.vendorId === d.vendorId)?.role;
      const c = d.collections.find((c) => c.usagePage === USAGE.usagePage && c.usage === USAGE.usage);
      if (!role || !c?.outputReports?.some((r) => r.reportId === REPORT_ID)) continue;
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

  battery() {
    return this.exclusive(async () => {
      const r = await this.xfer(frame([CMD.BATTERY, 0xa5, 0x0b, 0x2e, 1, 1, 1])).catch(() => null);
      return r ? Math.min(100, r[7]) : null;
    });
  }
}
