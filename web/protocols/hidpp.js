import { sleep, hex, Unsupported } from '../common.js';
import { Mouse55 } from './mouse55.js';

// Logitech HID++ 2.0 over a Lightspeed receiver (G304 / G305 and similar), as documented by the
// open-source Solaar and libratbag projects. Only host-mode settings are written: the current DPI,
// the report rate and the battery read. Onboard-profile flash (DPI stages, buttons) is not touched.

export const REPORT = { SHORT: 0x10, LONG: 0x11 };
export const FEATURE = { ROOT: 0x0000, BATTERY: 0x1000, UNIFIED_BATTERY: 0x1004, DPI: 0x2201, RATE: 0x8060, ONBOARD: 0x8100 };
export const RATE_MS = { 1: 8, 2: 4, 3: 2, 4: 1 }; // settings value -> ms per report (125/250/500/1000 Hz)
const SW = 0x0a;
const HOST_MODE = 2;

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
  setButtons() { return Promise.reject(new Unsupported('Button remapping')); }
  setMacros() { return Promise.reject(new Unsupported('Macros')); }

  // Host mode lets the DPI and report rate below take effect; the mouse returns to its onboard
  // profile when it is switched off.
  setMouseConfig(m) {
    return this.exclusive(async () => {
      await this.call(FEATURE.ONBOARD, 1, [HOST_MODE]);
      const dpi = clampDpi(m.dpi[m.dpiIndex]);
      await this.call(FEATURE.DPI, 3, [0, dpi >> 8, dpi & 0xff]);
      const ms = RATE_MS[m.rate];
      if (ms && !(await this.call(FEATURE.RATE, 2, [ms]))) this.log('⚠', 'Report rate feature not found');
    });
  }

  battery() {
    return this.exclusive(async () => {
      if (!this.link) return null;
      const u = await this.call(FEATURE.UNIFIED_BATTERY, 1, []).catch(() => null);
      if (u) return Math.min(100, u[3]);
      const b = await this.call(FEATURE.BATTERY, 0, []).catch(() => null);
      return b ? Math.min(100, b[3]) : null;
    });
  }
}
