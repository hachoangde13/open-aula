import { sleep, hex, Unsupported } from '../common.js';
import { Mouse55 } from './mouse55.js';

// Logitech HID++ 2.0 over a Lightspeed receiver (G304 / G305 and similar), as documented by the
// open-source Solaar and libratbag projects. DPI stages, report rate and buttons are written into the
// mouse's onboard profile (feature 0x8100) with a read-modify-write, so they survive power-off; the
// existing profile's CRC must check out before anything is written. Mice without onboard profiles
// fall back to host-mode DPI and report rate.

export const REPORT = { SHORT: 0x10, LONG: 0x11 };
export const FEATURE = { ROOT: 0x0000, FW_VERSION: 0x0003, BATTERY: 0x1000, BATTERY_VOLTAGE: 0x1001, UNIFIED_BATTERY: 0x1004, DPI: 0x2201, RATE: 0x8060, ONBOARD: 0x8100 };
export const RATE_MS = { 1: 8, 2: 4, 3: 2, 4: 1 }; // settings value -> ms per report (125/250/500/1000 Hz)
const SW = 0x0a;
const HOST_MODE = 2;
const ONBOARD_MODE = 1;
const ROM_SECTOR = 0x100;
const PROFILE = { RATE: 0, DEFAULT_DPI: 1, DPI: 3, DPI_SLOTS: 5, BUTTONS: 32 };
const SPECIAL_DPI_CYCLE = 0x05;
// App mouse action id -> HID++ mouse-button bitmask (left, middle, right, back, forward).
const MOUSE_BITS = { 1: 0x01, 2: 0x04, 3: 0x02, 7: 0x08, 8: 0x10 };

// CRC-16/CCITT-FALSE, stored big-endian in the last two bytes of each sector.
export function crc16(bytes) {
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}
export const crcOk = (sec) => crc16(sec.subarray(0, sec.length - 2)) === ((sec[sec.length - 2] << 8) | sec[sec.length - 1]);
// Sanity check for a profile sector without a trustworthy CRC: a real report rate and DPI list.
export function plausibleProfile(p) {
  if (![1, 2, 4, 8].includes(p[PROFILE.RATE]) || p[PROFILE.DEFAULT_DPI] >= PROFILE.DPI_SLOTS) return false;
  const first = p[PROFILE.DPI] | (p[PROFILE.DPI + 1] << 8);
  return first >= 50 && first <= 32000;
}
export function sealCrc(sec) {
  const c = crc16(sec.subarray(0, sec.length - 2));
  sec[sec.length - 2] = c >> 8; sec[sec.length - 1] = c & 0xff;
  return sec;
}

// 4-byte onboard binding for an app button action; null keeps the mouse's current binding.
export function encodeBinding(a) {
  switch (a?.type) {
    case undefined: case null: case 'default': return null;
    case 'disable': return [0xff, 0, 0, 0];
    case 'mouse': {
      const bit = MOUSE_BITS[a.id];
      if (!bit) throw new Unsupported('Double click and scroll as a button action');
      return [0x80, 0x01, bit >> 8, bit & 0xff];
    }
    case 'key':
      if (a.code >= 0xe0 && a.code <= 0xe7) return [0x80, 0x02, (a.mods & 0xff) | (1 << (a.code - 0xe0)), 0];
      return [0x80, 0x02, a.mods & 0xff, a.code & 0xff];
    case 'media': return [0x80, 0x03, (a.usage >> 8) & 0xff, a.usage & 0xff];
    case 'dpiLoop': return [0x90, SPECIAL_DPI_CYCLE, 0, 0];
    case 'macro': throw new Unsupported('Macros on buttons');
    default: throw new Unsupported(`Button action "${a.type}"`);
  }
}

// Onboard binding -> app action; null for anything this page cannot edit (macros, other specials).
export function decodeBinding(b) {
  const [t, a, c, d] = b;
  if (t === 0xff) return { type: 'disable' };
  if (t === 0x90) return a === SPECIAL_DPI_CYCLE ? { type: 'dpiLoop' } : null;
  if (t !== 0x80) return null;
  if (a === 0x01) {
    const id = Object.keys(MOUSE_BITS).find((k) => MOUSE_BITS[k] === ((c << 8) | d));
    return id ? { type: 'mouse', id: +id } : null;
  }
  if (a === 0x02) return { type: 'key', mods: c, code: d };
  if (a === 0x03) return { type: 'media', usage: (c << 8) | d };
  return null;
}

export function parseProfile(p, buttons) {
  const dpi = [];
  for (let i = 0; i < PROFILE.DPI_SLOTS; i++) {
    const v = p[PROFILE.DPI + i * 2] | (p[PROFILE.DPI + i * 2 + 1] << 8);
    if (v && v !== 0xffff) dpi.push(clampDpi(v));
  }
  if (!dpi.length) dpi.push(800);
  const rate = +Object.keys(RATE_MS).find((k) => RATE_MS[k] === p[PROFILE.RATE]) || 4;
  return {
    rate, dpi, dpiIndex: Math.min(p[PROFILE.DEFAULT_DPI], dpi.length - 1),
    buttons: Array.from({ length: buttons }, (_, i) => decodeBinding(p.subarray(PROFILE.BUTTONS + i * 4, PROFILE.BUTTONS + i * 4 + 4))),
  };
}

export function applyButtons(profile, buttons, count) {
  for (let i = 0; i < count; i++) {
    const b = encodeBinding(buttons?.[i]);
    if (b) profile.set(b, PROFILE.BUTTONS + i * 4);
  }
  return profile;
}

export function applyConfig(profile, m) {
  const ms = RATE_MS[m.rate];
  if (ms) profile[PROFILE.RATE] = ms;
  for (let i = 0; i < PROFILE.DPI_SLOTS; i++) {
    const v = i < m.dpi.length ? clampDpi(m.dpi[i]) : 0;
    profile[PROFILE.DPI + i * 2] = v & 0xff; profile[PROFILE.DPI + i * 2 + 1] = v >> 8;
  }
  profile[PROFILE.DEFAULT_DPI] = Math.min(m.dpiIndex, m.dpi.length - 1);
  return profile;
}


export const clampDpi = (v) => Math.max(100, Math.min(12000, Math.round((v | 0) / 50) * 50));

export function message(index, feature, fn, params = []) {
  const p = new Uint8Array(19);
  p[0] = index; p[1] = feature; p[2] = (fn << 4) | SW;
  p.set(params.slice(0, 16), 3);
  return p;
}

export class HidPP extends Mouse55 {
  static async discover(devices, model) {
    for (const d of devices) {
      const ok = d.collections.some((c) => c.usagePage === 0xff00 && c.outputReports?.some((r) => r.reportId === REPORT.LONG));
      if (!ok) continue;
      if (!d.opened) await d.open();
      const kb = new HidPP({ dongle: { dev: d, reportId: REPORT.LONG } }, model);
      for (let index = 1; index <= 6; index++) {
        kb.index = index;
        kb.features = new Map([[FEATURE.ROOT, 0]]);
        const v = await kb.call(FEATURE.ROOT, 1, [0, 0, 0x5a], 300).catch(() => null);
        if (!v || v[3] < 2) continue;
        if (await kb.featureIndex(FEATURE.DPI).catch(() => 0)) return { dongle: { dev: d, reportId: REPORT.LONG }, index };
      }
    }
    return null;
  }

  constructor(handles = {}, model, opts) {
    super({ dongle: handles.dongle }, model, opts);
    this.index = handles.index ?? 1;
    this.features = new Map([[FEATURE.ROOT, 0]]);
    this.pending = null;
    if (this.link) {
      this.link.dev.addEventListener('inputreport', (e) => {
        if (e.reportId !== REPORT.SHORT && e.reportId !== REPORT.LONG) return;
        const r = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength).slice();
        if (this.pending?.(r)) this.pending = null;
      });
    }
  }

  // Send one request and wait for the reply with the same device, feature, function and software id.
  async xfer(p, timeout = 1000) {
    this.log('→', `11 ${hex(p)}`);
    if (!this.link) { await sleep(1); const r = p.slice(); r[3] = 1; return r; }
    const reply = new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending = null; reject(new Error(`No reply to HID++ feature ${p[1]} fn ${p[2] >> 4}`)); }, timeout);
      this.pending = (r) => {
        if (r[0] !== p[0]) return false;
        if (r[1] === 0xff && r[2] === p[1] && r[3] === p[2]) { clearTimeout(t); reject(new Error(`HID++ error 0x${r[4].toString(16)}`)); return true; }
        if (r[1] === 0x8f && r[2] === p[1]) { clearTimeout(t); reject(new Error('Not a HID++ 2.0 device')); return true; }
        if (r[1] !== p[1] || r[2] !== p[2]) return false;
        clearTimeout(t); resolve(r); return true;
      };
    });
    await this.link.dev.sendReport(REPORT.LONG, p);
    const r = await reply;
    this.log('←', hex(r));
    return r;
  }

  async featureIndex(id) {
    if (!this.features.has(id)) {
      const r = await this.xfer(message(this.index, 0, 0, [id >> 8, id & 0xff]));
      this.features.set(id, r[3]);
    }
    return this.features.get(id);
  }

  async call(id, fn, params, timeout) {
    const idx = await this.featureIndex(id);
    if (id !== FEATURE.ROOT && !idx) return null;
    return this.xfer(message(this.index, idx, fn, params), timeout);
  }

  setLighting() { return Promise.reject(new Unsupported('Lighting')); }
  setMacros() { return Promise.reject(new Unsupported('Macros')); }

  async onboardInfo() {
    const r = await this.call(FEATURE.ONBOARD, 0, []);
    if (!r) return null;
    // Same checks as libratbag: memory model 1, a known profile format, macro format 1.
    if (r[3] !== 1 || r[4] < 1 || r[4] > 5 || r[5] !== 1) throw new Error('Unknown onboard profile format; nothing was written');
    const info = { profiles: r[6], buttons: r[8], sectorSize: (r[10] << 8) | r[11] };
    if (info.sectorSize < 64 || info.sectorSize > 1024 || !info.profiles) throw new Error('Unexpected onboard memory layout; nothing was written');
    return info;
  }

  async readSector(sector, size) {
    const out = new Uint8Array(size);
    for (let off = 0; off < size; off += 16) {
      const o = Math.min(off, size - 16);
      const r = await this.call(FEATURE.ONBOARD, 5, [sector >> 8, sector & 0xff, o >> 8, o & 0xff]);
      out.set(r.subarray(3, 19), o);
    }
    return out;
  }

  async writeSector(sector, data) {
    this.log('⚙', `Writing onboard sector 0x${sector.toString(16)} (${data.length} bytes)`);
    await this.call(FEATURE.ONBOARD, 6, [sector >> 8, sector & 0xff, 0, 0, data.length >> 8, data.length & 0xff]);
    for (let off = 0; off < data.length; off += 16) await this.call(FEATURE.ONBOARD, 7, Array.from(data.subarray(off, off + 16)));
    await this.call(FEATURE.ONBOARD, 8, []);
  }

  // Read the active profile, let `edit` change it, and write it back to a user sector.
  // A ROM profile (read-only) is copied to user sector 1 and enabled in the profile directory.
  async loadProfile() {
    const info = await this.onboardInfo();
    if (!info) return null;
    const cur = await this.call(FEATURE.ONBOARD, 4, []);
    let sector = (cur[3] << 8) | cur[4];
    const user = sector >= 1 && sector <= info.profiles;
    // Anything that is not a user profile (ROM profile, or no active profile) starts from ROM profile 1.
    if (!user) sector = ROM_SECTOR + 1;
    const profile = await this.readSector(sector, info.sectorSize);
    // User sectors carry a CRC; ROM sectors are not guaranteed to (libratbag skips the check there).
    if (user ? !crcOk(profile) : !plausibleProfile(profile)) {
      throw new Error(`Onboard profile 0x${sector.toString(16)} has an unexpected format; nothing was written`);
    }
    return { info, sector, user, profile };
  }

  // Read what the mouse holds now: DPI stages, report rate and button bindings of the active profile.
  readMouseConfig() {
    return this.exclusive(async () => {
      const l = await this.loadProfile();
      return l ? parseProfile(l.profile, Math.min(l.info.buttons, 16)) : null;
    });
  }

  async editProfile(edit) {
    const l = await this.loadProfile();
    if (!l) return false;
    const { info, sector, user, profile } = l;
    edit(profile, info);
    sealCrc(profile);
    const target = user ? sector : 1;
    await this.writeSector(target, profile);
    if (!user) {
      // The G305 answers "invalid argument" when the directory was never written; treat that as empty.
      const old = await this.readSector(0, info.sectorSize).catch(() => null);
      const dir = new Uint8Array(info.sectorSize).fill(0xff);
      for (let i = 0; i < info.profiles; i++) {
        const was = old && crcOk(old) && ((old[i * 4] << 8) | old[i * 4 + 1]) === i + 1 ? old[i * 4 + 2] : 0;
        dir.set([0x00, i + 1, i === 0 ? 1 : was ? 1 : 0, 0x00], i * 4);
      }
      dir.set([0xff, 0xff, 0x00, 0x00], info.profiles * 4);
      await this.writeSector(0, sealCrc(dir));
    }
    await this.call(FEATURE.ONBOARD, 1, [ONBOARD_MODE]);
    await this.call(FEATURE.ONBOARD, 3, [target >> 8, target & 0xff]);
    return true;
  }

  setButtons(buttons) {
    return this.exclusive(async () => {
      for (const b of buttons ?? []) encodeBinding(b); // reject unsupported actions before touching the mouse
      if (!this.link) { this.log('⚙', 'Simulated onboard profile write (buttons)'); return; }
      if (!(await this.editProfile((p, info) => applyButtons(p, buttons, Math.min(info.buttons, 16))))) {
        throw new Unsupported('Button remapping without onboard profiles');
      }
    });
  }

  // Onboard profile when available (persists); otherwise host-mode DPI and report rate, which last
  // until the mouse is switched off.
  setMouseConfig(m) {
    return this.exclusive(async () => {
      if (!this.link) { this.log('⚙', 'Simulated onboard profile write (DPI, rate)'); return; }
      if (await this.editProfile((p) => applyConfig(p, m))) return;
      await this.call(FEATURE.ONBOARD, 1, [HOST_MODE]);
      const dpi = clampDpi(m.dpi[m.dpiIndex]);
      await this.call(FEATURE.DPI, 3, [0, dpi >> 8, dpi & 0xff]);
      const ms = RATE_MS[m.rate];
      if (ms && !(await this.call(FEATURE.RATE, 2, [ms]))) this.log('⚠', 'Report rate feature not found');
    });
  }

  // Main application firmware from feature 0x0003, formatted like Solaar: "U1 19.02.B0012".
  firmware() {
    return this.exclusive(async () => {
      const n = await this.call(FEATURE.FW_VERSION, 0, []);
      if (!n) return null;
      const h = (v, w) => v.toString(16).toUpperCase().padStart(w, '0');
      const fmt = (r) => `${String.fromCharCode(...r.subarray(4, 7)).replace(/\0/g, '').trim()} ${h(r[7], 2)}.${h(r[8], 2)}.B${h((r[9] << 8) | r[10], 4)}`;
      let first = null;
      for (let i = 0; i < n[3]; i++) {
        const r = await this.call(FEATURE.FW_VERSION, 1, [i]).catch(() => null);
        if (!r) continue;
        if ((r[3] & 0x0f) === 0) return fmt(r); // 0 = main application
        first ??= fmt(r);
      }
      return first;
    });
  }

  battery() {
    return this.exclusive(async () => {
      if (!this.link) return null;
      const u = await this.call(FEATURE.UNIFIED_BATTERY, 1, []).catch(() => null);
      if (u) return Math.min(100, u[3]);
      const b = await this.call(FEATURE.BATTERY, 0, []).catch(() => null);
      if (b) return Math.min(100, b[3]);
      // G304/G305: only the cell voltage (mV, one AA). Rough estimate: 1.0 V empty, 1.5 V full.
      const v = await this.call(FEATURE.BATTERY_VOLTAGE, 0, []).catch(() => null);
      if (!v) return null;
      const mv = (v[3] << 8) | v[4];
      return Math.max(0, Math.min(100, Math.round((mv - 1000) / 5)));
    });
  }
}
