import s75pro from './s75pro.js';
import f87pro from './f87pro.js';
import f75 from './f75.js';
import f75max from './f75max.js';
import sc620 from './sc620.js';
import m3pro from './m3pro.js';
import { Aula04 } from '../protocols/aula04.js';
import { AA } from '../protocols/aa.js';
import { G5KB } from '../protocols/g5kb.js';
import { Mouse55 } from '../protocols/mouse55.js';
import { SmailM3 } from '../protocols/smailm3.js';
import { matchesId } from '../common.js';

export const MODELS = [s75pro, f87pro, f75, f75max, sc620, m3pro];
const PROTOCOLS = { aula04: Aula04, aa: AA, g5kb: G5KB, mouse55: Mouse55, smailm3: SmailM3 };

export const modelById = (id) => MODELS.find((m) => m.id === id) ?? MODELS[0];

export const hidFilters = () => MODELS.flatMap((m) => m.usb.map(({ vendorId, productId, usagePage, usage }) =>
  (productId == null ? { vendorId, usagePage, usage } : { vendorId, productId })));

export const modelForDevice = (dev) => MODELS.find((m) => matchesId(dev, m.usb));

export async function attachModel(model, devices, opts) {
  const mine = devices.filter((d) => matchesId(d, model.usb));
  if (!mine.length) return null;
  const Proto = PROTOCOLS[model.protocol];
  const handles = await Proto.discover(mine, model);
  return handles ? new Proto(handles, model, opts) : null;
}

export async function attach(devices, opts) {
  for (const model of MODELS) {
    const mine = devices.filter((d) => matchesId(d, model.usb));
    if (!mine.length) continue;
    const Proto = PROTOCOLS[model.protocol];
    const handles = await Proto.discover(mine, model);
    if (handles) return new Proto(handles, model, opts);
  }
  return null;
}

export const simulator = (model, opts) => new PROTOCOLS[model.protocol]({}, model, opts);
