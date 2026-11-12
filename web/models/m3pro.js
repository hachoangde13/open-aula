import { MACRO_PLAY, BUTTON_SLOTS, USAGE } from '../protocols/smailm3.js';

// SMAILWOLF M3 Pro / M3 Pro+. The vendor app finds the mouse by vendor ID and the 0xFF01/0x10
// collection, not by product ID, so none is listed here.
export default {
  id: 'm3pro',
  name: 'SMAILWOLF M3 Pro / M3 Pro+',
  kind: 'mouse',
  protocol: 'smailm3',
  usb: [
    { vendorId: 0xa8a4, role: 'usb', ...USAGE },
    { vendorId: 0xa8a5, role: 'dongle', ...USAGE },
    { vendorId: 0x3837, role: 'dongle', ...USAGE },
  ],
  layout: [],
  image: { src: null, width: 297, height: 525 },
  features: { lighting: false, dpi: true, buttons: true, macros: true, settings: true },
  lightModes: [],
  macroPlay: MACRO_PLAY,
  buttonSlots: BUTTON_SLOTS,
  mouseDefaults: {
    dpi: [800, 1600, 2400, 3200, 6400, 12000],
    dpiIndex: 1,
    // The M3 has no DPI colours; kept only because the DPI page edits them.
    dpiColors: [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [0, 255, 255], [255, 0, 255]],
    buttons: [],
  },
  settings: [
    { key: 'rate', label: 'Polling rate', type: 'select', default: 4, options: [[1, '125 Hz'], [2, '250 Hz'], [3, '500 Hz'], [4, '1000 Hz']] },
    { key: 'sleep', label: 'Sleep after', type: 'select', default: 10, options: [[0, 'Never'], [1, '1 min'], [5, '5 min'], [10, '10 min'], [30, '30 min'], [60, '1 hour'], [100, '100 min']] },
    { key: 'debounce', label: 'Button debounce (ms)', type: 'number', min: 0, max: 30, default: 8 },
    { key: 'liftoff', label: 'Lift-off distance', type: 'select', default: 1, options: [[1, 'Low (1 mm)'], [2, 'High (2 mm)']] },
    { key: 'scrollReverse', label: 'Reverse scroll direction', type: 'check', default: 0 },
    { key: 'angleSnap', label: 'Line correction', type: 'check', default: 0 },
    { key: 'esports', label: 'High-speed mode', type: 'check', default: 0 },
  ],
};
