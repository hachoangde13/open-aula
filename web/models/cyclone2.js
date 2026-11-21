import { TARGETS, SLOTS, USAGE_PAGE } from '../protocols/gamesir.js';

// GameSir Cyclone 2 in XInput mode (green LED; hold View + Menu to cycle modes). In Switch and DS4
// modes it borrows Nintendo's and Sony's IDs and has no configuration channel.
export default {
  id: 'cyclone2',
  name: 'GameSir Cyclone 2',
  kind: 'gamepad',
  protocol: 'gamesir',
  usb: [
    { vendorId: 0x3537, productId: 0x1053, role: 'usb', usagePage: USAGE_PAGE },
    { vendorId: 0x3537, productId: 0x100b, role: 'dongle', usagePage: USAGE_PAGE },
  ],
  layout: [],
  image: { src: null, width: 1, height: 1 },
  features: { buttons: true, settings: true },
  lightModes: [],
  buttonSlots: SLOTS.map((name, slot) => ({ slot, name: { L4: 'L4 (back left)', R4: 'R4 (back right)' }[name] ?? name, x: 0, y: 0 })),
  buttonTypes: ['default', 'pad'],
  padTargets: TARGETS,
  mouseDefaults: { dpi: [], dpiIndex: 0, dpiColors: [], buttons: [] },
  settings: [
    { key: 'profile', label: 'Profile (settings below apply to it)', type: 'select', default: 1, options: [[1, '1'], [2, '2'], [3, '3'], [4, '4']] },
    { key: 'rate', label: 'Polling rate', type: 'select', default: 2, options: [[0, '250 Hz'], [1, '500 Hz'], [2, '1000 Hz']] },
    { key: 'vibrationLeft', label: 'Vibration, left motor', type: 'select', default: 3, options: [[0, 'Off'], [1, '25%'], [2, '50%'], [3, '75%'], [4, '100%']] },
    { key: 'vibrationRight', label: 'Vibration, right motor', type: 'select', default: 3, options: [[0, 'Off'], [1, '25%'], [2, '50%'], [3, '75%'], [4, '100%']] },
    { key: 'leftDeadzone', label: 'Left stick deadzone (%)', type: 'number', min: 0, max: 100, default: 10 },
    { key: 'rightDeadzone', label: 'Right stick deadzone (%)', type: 'number', min: 0, max: 100, default: 10 },
    { key: 'leftSquare', label: 'Left stick: square output (full speed on diagonals)', type: 'check', default: 0 },
    { key: 'rightSquare', label: 'Right stick: square output', type: 'check', default: 0 },
    { key: 'ltDeadzone', label: 'LT deadzone (%)', type: 'number', min: 0, max: 100, default: 5 },
    { key: 'rtDeadzone', label: 'RT deadzone (%)', type: 'number', min: 0, max: 100, default: 5 },
    { key: 'ltHair', label: 'LT hair trigger (adaptive)', type: 'check', default: 0 },
    { key: 'rtHair', label: 'RT hair trigger (adaptive)', type: 'check', default: 0 },
    { key: 'brightness', label: 'Light brightness (%)', type: 'number', min: 0, max: 100, default: 50 },
  ],
  updates: {
    latest: '3.5.2',
    links: [
      { label: 'GameSir Connect (settings and firmware updates)', url: 'https://gamesir.com/pages/gamesir-connect-software' },
      { label: 'Cyclone 2 dongle and controller firmware update guide', url: 'https://gamesir.com/pages/cyclone-2-dongle-and-controller-firmware-update-guide' },
      { label: 'Cyclone 2 FAQ', url: 'https://gamesir.com/pages/faq-questions-about-cyclone-2' },
    ],
    note: 'Use XInput mode (green LED). GameSir advises dongle V1.1.9+ with controller V3.4.4+. 3.5.2 is the newest controller image bundled in GameSir Connect 1.14.5; newer releases may exist.',
  },
};
