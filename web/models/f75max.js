import s75pro from './s75pro.js';
import { KEYS } from './f75max.layout.js';

// Epomaker x AULA F75 Max: same USB IDs and `aula04` protocol family as the S75 Pro,
// but with a 128 x 128 screen and no side light bar.
// Not tested here on a real F75 Max; IDs, device name, key slots and screen format agree with the
// community Linux driver github.com/DonAsako/AulaF75Driver, which was checked on hardware.
const F75_MAX_NAME = /F75\s*-?\s*Max/i;

export default {
  ...s75pro,
  id: 'f75max',
  name: 'AULA F75 Max',
  // Over USB the keyboard reports "SONiX AULA F75Max"; its dongle reports only "2.4G Dongle".
  usb: s75pro.usb.map(({ notName, ...i }) => (i.role === 'usb' ? { ...i, name: F75_MAX_NAME } : i)),
  layout: KEYS,
  // No photo yet: keys are drawn on an 800 x 300 grid.
  image: { src: null, width: s75pro.image.width, height: s75pro.image.height },
  features: { ...s75pro.features, bar: false },
  barModes: [],
  screen: { width: 128, height: 128, headLength: 256, maxFrames: 255, chunk: 4096 },
  updates: {
    links: [
      { label: 'Epomaker x AULA F75 Max driver (Windows, v1.0.0.5)', url: 'https://epomaker.com/blogs/software/epomaker-x-aula-f75-max-driver' },
      { label: 'AULA F75 Max driver (AULA Gear, ISO-DE layout)', url: 'https://aulagear.com/blogs/software/aula-f75-max' },
    ],
    note: 'No official firmware file was found for the F75 Max.',
  },
};

export { F75_MAX_NAME };
