// Estimates how long each word takes to SAY, in "letter-equivalents", for
// read-along highlighting on voices that don't report word positions.
// Counting raw characters fell behind on anything short to write but long
// to say: "1998" is 4 characters but "nineteen ninety eight" out loud,
// "CPU" is spelled letter by letter, "%" is "percent".

const SMALL = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES: [number, string][] = [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']];

export function integerWords(n: number): string {
  if (n < 20) return SMALL[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ` ${SMALL[n % 10]}` : '');
  if (n < 1000) return `${SMALL[Math.floor(n / 100)]} hundred${n % 100 ? ` and ${integerWords(n % 100)}` : ''}`;
  for (const [value, name] of SCALES) {
    if (n >= value) return `${integerWords(Math.floor(n / value))} ${name}${n % value ? ` ${integerWords(n % value)}` : ''}`;
  }
  return String(n);
}

// "1998" is said as a year ("nineteen ninety eight"), not "one thousand…".
function yearWords(n: number): string {
  if (n >= 2000 && n <= 2009) return integerWords(n);
  const hi = Math.floor(n / 100);
  const lo = n % 100;
  return `${integerWords(hi)} ${lo === 0 ? 'hundred' : lo < 10 ? `oh ${integerWords(lo)}` : integerWords(lo)}`;
}

function numberUnits(raw: string): number {
  let units = 0;
  let s = raw;
  if (s.endsWith('%')) { units += 7; s = s.slice(0, -1); }
  const [intPart, decPart] = s.replace(/,/g, '').split('.');
  const n = Number(intPart);
  if (!Number.isFinite(n) || intPart.length > 12) {
    units += intPart.length * 5;
  } else if (intPart.length === 4 && !raw.includes(',') && n >= 1100 && n <= 2099) {
    units += yearWords(n).length;
  } else {
    units += integerWords(n).length;
  }
  if (decPart) units += 6 + decPart.length * 5; // "point" + each digit
  return units;
}

const SYMBOL_UNITS: Record<string, number> = {
  '%': 7, '+': 4, '=': 6, '&': 3, '/': 5, '*': 5, '<': 9, '>': 12, '^': 5, '#': 6, '@': 2, '$': 6, '°': 7,
};

/** Spoken length of one whitespace-free token, plus the pause after it. */
export function tokenUnits(token: string): number {
  let units = 1; // the gap before the next word
  if (/[.!?]["')\]]*$/.test(token)) units += 6;
  else if (/[,;:]["')\]]*$/.test(token)) units += 3;

  const core = token.replace(/^[("'[]+/, '').replace(/[)"'\],.;:!?]+$/, '');
  if (!core) return units;

  if (/^\d[\d,]*(\.\d+)?%?$/.test(core)) return units + numberUnits(core);
  // Acronyms are spelled out letter by letter (CPU → "see pee you").
  if (/^[A-Z]{2,6}s?$/.test(core)) return units + core.replace(/s$/, '').length * 3 + (core.endsWith('s') ? 1 : 0);

  for (const ch of core) {
    if (SYMBOL_UNITS[ch]) units += SYMBOL_UNITS[ch];
    else if (/\d/.test(ch)) units += 4; // digits inside words, e.g. "O(n2)", "3rd"
    else units += 1;
  }
  return units;
}

export interface UnitMap {
  tokens: { start: number; end: number; from: number; to: number }[];
  total: number;
}

export function buildUnitMap(text: string): UnitMap {
  const tokens: UnitMap['tokens'] = [];
  const re = /\S+/g;
  let match: RegExpExecArray | null;
  let total = 0;
  while ((match = re.exec(text)) !== null) {
    const units = tokenUnits(match[0]);
    tokens.push({ start: match.index, end: match.index + match[0].length, from: total, to: total + units });
    total += units;
  }
  return { tokens, total };
}

/** Text position reached after speaking `units` letter-equivalents. */
export function charAtUnits(map: UnitMap, units: number): number {
  const { tokens } = map;
  if (tokens.length === 0) return 0;
  let lo = 0;
  let hi = tokens.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tokens[mid].from <= units) lo = mid; else hi = mid - 1;
  }
  return tokens[lo].start;
}
