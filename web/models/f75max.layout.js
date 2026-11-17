import { KEYS as S75 } from './s75pro.layout.js';

// F75 Max key layout, drawn on an 800 x 300 grid (no photo). Rows are [y, [usage, x, width]...] in
// key units. 78 keys sit in the same matrix slots as on the S75 Pro; the F75 Max has PgUp (118)
// and PgDn (121) where the S75 Pro has Home and right Ctrl. Slot numbers were checked against the
// table in github.com/DonAsako/AulaF75Driver, which was confirmed on a real keyboard.
const UNIT = 40, GAP = 6, OX = 80, OY = 25;
const run = (codes, x) => codes.map((c, i) => [c, x + i, 1]);
const ROWS = [
  [0, [[0x29, 0, 1], ...run([0x3a, 0x3b, 0x3c, 0x3d], 1.25), ...run([0x3e, 0x3f, 0x40, 0x41], 5.5), ...run([0x42, 0x43, 0x44, 0x45], 9.75)]],
  [1.25, [...run([0x35, 0x1e, 0x1f, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x2d, 0x2e], 0), [0x2a, 13, 2], [0x4c, 15, 1]]],
  [2.25, [[0x2b, 0, 1.5], ...run([0x14, 0x1a, 0x08, 0x15, 0x17, 0x1c, 0x18, 0x0c, 0x12, 0x13, 0x2f, 0x30], 1.5), [0x31, 13.5, 1.5], [0x4b, 15, 1]]],
  [3.25, [[0x39, 0, 1.75], ...run([0x04, 0x16, 0x07, 0x09, 0x0a, 0x0b, 0x0d, 0x0e, 0x0f, 0x33, 0x34], 1.75), [0x28, 12.75, 2.25], [0x4e, 15, 1]]],
  [4.25, [[0xe1, 0, 2.25], ...run([0x1d, 0x1b, 0x06, 0x19, 0x05, 0x11, 0x10, 0x36, 0x37, 0x38], 2.25), [0xe5, 12.25, 1.75], [0x52, 14, 1], [0x4d, 15, 1]]],
  [5.25, [[0xe0, 0, 1.25], [0xe3, 1.25, 1.25], [0xe2, 2.5, 1.25], [0x2c, 3.75, 6.25], [0xe6, 10, 1.25], [0xaf, 11.25, 1.25], [0x50, 13, 1], [0x51, 14, 1], [0x4f, 15, 1]]],
];
const OWN = { 0x4b: { name: 'PgUp', idx: 118 }, 0x4e: { name: 'PgDn', idx: 121 } };
const byCode = new Map(S75.map((k) => [k.code, k]));

export const KEYS = ROWS.flatMap(([y, keys]) => keys.map(([code, x, w]) => {
  const src = OWN[code] ?? byCode.get(code);
  return {
    code, name: src.name, idx: src.idx, light: src.light ?? src.idx,
    x: OX + x * UNIT, y: OY + y * UNIT, w: w * UNIT - GAP, h: UNIT - GAP, fnLock: src.fnLock ?? false,
  };
}));
