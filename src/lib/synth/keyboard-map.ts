/** Two-octave computer mapping, FL-style. Z = C of the current octave. */
export const COMPUTER_KEY_TO_OFFSET: Record<string, number> = {
  z: 0,
  s: 1,
  x: 2,
  d: 3,
  c: 4,
  v: 5,
  g: 6,
  b: 7,
  h: 8,
  n: 9,
  j: 10,
  m: 11,
  ",": 12,
  l: 13,
  ".": 14,
  ";": 15,
  "/": 16,
  q: 12,
  "2": 13,
  w: 14,
  "3": 15,
  e: 16,
  r: 17,
  "5": 18,
  t: 19,
  "6": 20,
  y: 21,
  "7": 22,
  u: 23,
  i: 24,
  "9": 25,
  o: 26,
  "0": 27,
  p: 28,
};

/** Ableton Live computer MIDI keyboard. A = C. Z/X are Live's octave, not notes. */
export const LIVE_KEY_TO_OFFSET: Record<string, number> = {
  a: 0,
  w: 1,
  s: 2,
  e: 3,
  d: 4,
  f: 5,
  t: 6,
  g: 7,
  y: 8,
  h: 9,
  u: 10,
  j: 11,
  k: 12,
  o: 13,
  l: 14,
  p: 15,
  ";": 16,
};

function invert(map: Record<string, number>, preferred: string[]): Record<number, string> {
  const out: Record<number, string> = {};
  for (const key of preferred) {
    const offset = map[key];
    if (offset === undefined) continue;
    if (out[offset] === undefined) out[offset] = key;
  }
  return out;
}

export const OFFSET_TO_COMPUTER_KEY: Record<number, string> = invert(COMPUTER_KEY_TO_OFFSET, [
  "z",
  "s",
  "x",
  "d",
  "c",
  "v",
  "g",
  "b",
  "h",
  "n",
  "j",
  "m",
  "q",
  "2",
  "w",
  "3",
  "e",
  "r",
  "5",
  "t",
  "6",
  "y",
  "7",
  "u",
  "i",
  "9",
  "o",
  "0",
  "p",
]);

export const OFFSET_TO_LIVE_KEY: Record<number, string> = invert(LIVE_KEY_TO_OFFSET, [
  "a",
  "w",
  "s",
  "e",
  "d",
  "f",
  "t",
  "g",
  "y",
  "h",
  "u",
  "j",
  "k",
  "o",
  "l",
  "p",
  ";",
]);

export function computerKeyOffset(code: string, live = false): number | undefined {
  const key = code.toLowerCase();
  return live ? LIVE_KEY_TO_OFFSET[key] : COMPUTER_KEY_TO_OFFSET[key];
}

/** Keys Live's computer MIDI keyboard owns, including Z/X octave. */
export function isLivePassthroughKey(code: string): boolean {
  const key = code.toLowerCase();
  return key in LIVE_KEY_TO_OFFSET || key === "z" || key === "x";
}
