// Logitech G304 / G305 (HERO sensor, 6 buttons) through its Lightspeed receiver. Other receiver product IDs
// are listed because the same mice ship with several; discover() keeps only a HID++ 2.0 mouse
// that has the adjustable-DPI feature.
export default {
  id: 'g304',
  name: 'Logitech G304 / G305',
  kind: 'mouse',
  protocol: 'hidpp',
  usb: [0xc539, 0xc53a, 0xc53f, 0xc547, 0xc54d].map((productId) => ({ vendorId: 0x046d, productId, role: 'dongle' })),
  layout: [],
  image: { src: null, width: 297, height: 525 },
  features: { lighting: false, dpi: true, buttons: true, macros: false, settings: true },
  lightModes: [],
  macroPlay: [],
  buttonSlots: [
    { slot: 0, name: 'Left click', x: 0, y: 0, locked: true },
    { slot: 1, name: 'Right click', x: 0, y: 0 },
    { slot: 2, name: 'Wheel click', x: 0, y: 0 },
    { slot: 3, name: 'Back (side)', x: 0, y: 0 },
    { slot: 4, name: 'Forward (side)', x: 0, y: 0 },
    { slot: 5, name: 'DPI button (top)', x: 0, y: 0 },
  ],
  buttonTypes: ['default', 'disable', 'mouse', 'key', 'media', 'dpiLoop'],
  mouseDefaults: {
    // Five DPI slots in the onboard profile; the selected one is the profile's default.
    dpi: [400, 800, 1600, 3200, 6400],
    dpiIndex: 2,
    dpiColors: [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [0, 255, 255]],
    buttons: [],
  },
  settings: [
    { key: 'rate', label: 'Polling rate', type: 'select', default: 4, options: [[1, '125 Hz'], [2, '250 Hz'], [3, '500 Hz'], [4, '1000 Hz']] },
  ],
};
