import { SIZE_MAP as TYPED_SIZE_MAP, DECADE_MAP as TYPED_DECADE_MAP } from '../types';

/**
 * Structured parse of a spoken inventory entry.
 *
 * Missing fields are `null` (never placeholder strings or zero) so the
 * merge logic can use simple `??` semantics: incoming.value ?? existing.value
 * — and so the UI can distinguish "field intentionally empty" from
 * "field detected and equal to a default".
 */
export interface ParsedItem {
  size: string | null;
  decade: string | null;
  item_name: string | null;
  price: number | null;
  /** Human-readable label, e.g. "(M) 90's Polo Bomber". Built from the fields. */
  raw_title: string;
  /** The original transcript text we parsed — what the user actually said. */
  raw_transcript: string;
  /** 0–100 score: 25 points per detected field. */
  confidence: number;
}

/** Default empty parse — used as the merge identity. */
export const EMPTY_ITEM: ParsedItem = {
  size: null,
  decade: null,
  item_name: null,
  price: null,
  raw_title: '',
  raw_transcript: '',
  confidence: 0,
};

/**
 * Compute the per-item confidence score: 25 points for each non-null field.
 */
export function getConfidenceScore(item: ParsedItem): number {
  return item.confidence;
}

/**
 * Pick the better item_name across a merge.
 *
 * Rules:
 *   1. If incoming is null → keep existing.
 *   2. If existing is null → take incoming.
 *   3. Otherwise prefer the longer name. Longer item names usually carry
 *      a brand-name proper noun ("Carhartt Detroit Jacket") whereas a
 *      one- or two-word incoming string is more often filler from a
 *      partial utterance ("Its A", "I Would Say").
 */
function pickItemName(existing: string | null, incoming: string | null): string | null {
  if (incoming === null) return existing;
  if (existing === null) return incoming;
  return incoming.length > existing.length ? incoming : existing;
}

/**
 * Merge two parsed items non-destructively.
 *
 * For every field except item_name, `incoming ?? existing` — incoming wins
 * when it actually detected a value, otherwise existing is preserved.
 *
 * For item_name, we use the "longer wins" heuristic above so partial
 * utterances like "small" or "actually thirty dollars" don't replace a
 * meaningful name accumulated from earlier transcripts.
 *
 * raw_transcript reflects the latest utterance for the "what was heard"
 * reveal in the UI.
 */
export function mergeItems(existing: ParsedItem, incoming: ParsedItem): ParsedItem {
  const size = incoming.size ?? existing.size;
  const decade = incoming.decade ?? existing.decade;
  const price = incoming.price ?? existing.price;
  const item_name = pickItemName(existing.item_name, incoming.item_name);

  const confidence =
    (size !== null ? 25 : 0) +
    (decade !== null ? 25 : 0) +
    (price !== null ? 25 : 0) +
    (item_name !== null ? 25 : 0);

  const sizeDisplay = size ?? '?';
  const decadeDisplay = decade ?? '?';
  const nameDisplay = item_name ?? 'Unknown Item';

  return {
    size,
    decade,
    item_name,
    price,
    raw_title: `(${sizeDisplay}) ${decadeDisplay} ${nameDisplay}`,
    raw_transcript: incoming.raw_transcript || existing.raw_transcript,
    confidence,
  };
}

// ─── Number words ────────────────────────────────────────────────────────────

const WORD_NUMBERS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

const MULTIPLIERS: Record<string, number> = {
  hundred: 100,
  thousand: 1000,
};

const PRICE_INDICATORS = new Set(['dollars', 'dollar', 'bucks', 'buck']);

/**
 * Retail price slang where "one fifty" colloquially means $150 (not $51).
 * This is checked before generic word-number parsing so "one fifty" / "two
 * fifty" / etc. resolve to the hundreds value resellers actually mean.
 */
const PRICE_SLANG: Record<string, number> = {
  'one fifty': 150,
  'two fifty': 250,
  'three fifty': 350,
  'four fifty': 450,
  'five fifty': 550,
  'six fifty': 650,
  'seven fifty': 750,
  'eight fifty': 850,
  'nine fifty': 950,
};

// ─── Public small-string parsers (still used by tests + segmented path) ──────

export function parsePrice(text: string): number | null {
  const cleaned = text.toLowerCase().replace(/dollars?|bucks?|\$/g, '').trim();
  if (cleaned === '') return null;

  // Slang first: "one fifty" → 150
  if (PRICE_SLANG[cleaned] !== undefined) return PRICE_SLANG[cleaned];

  // Direct numeric: "75", "75.00", "12.50"
  const directNum = parseFloat(cleaned.replace(/,/g, ''));
  if (!isNaN(directNum) && directNum > 0) return directNum;

  const words = cleaned.replace(/-/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;

  let total = 0;
  let current = 0;
  let foundAny = false;

  for (const word of words) {
    if (word === 'and') continue;

    const num = WORD_NUMBERS[word];
    if (num !== undefined) {
      current += num;
      foundAny = true;
      continue;
    }

    const mult = MULTIPLIERS[word];
    if (mult !== undefined) {
      current = (current === 0 ? 1 : current) * mult;
      foundAny = true;
      continue;
    }

    const parsed = parseFloat(word);
    if (!isNaN(parsed)) {
      current += parsed;
      foundAny = true;
    }
  }

  total += current;
  return foundAny && total > 0 ? total : null;
}

/**
 * Local extension to SIZE_MAP for entries that don't live in src/types.
 * Keeping these here avoids broadening the Size enum unnecessarily.
 */
const EXTENDED_SIZE_MAP: Record<string, string> = {
  ...TYPED_SIZE_MAP,
  'double extra large': 'XXL',
  'triple extra large': 'XXXL',
  'one size': 'OS',
  'one size fits all': 'OS',
  'os': 'OS',
  'free size': 'OS',
};

const SIZE_MULTI_WORD = [
  'one size fits all',
  'one size',
  'free size',
  'double extra large',
  'triple extra large',
  'extra small',
  'x small',
  'extra large',
  'x large',
  'xx large',
  'double xl',
];

const SIZE_SINGLE_WORD = [
  'small', 'medium', 'large',
  'xs', 's', 'm', 'l', 'xl', 'xxl', 'xxxl', '2xl', 'os',
];

export function parseSize(text: string): string | null {
  const lower = text.toLowerCase().trim();
  if (lower === '') return null;

  if (EXTENDED_SIZE_MAP[lower]) return EXTENDED_SIZE_MAP[lower];

  for (const phrase of SIZE_MULTI_WORD) {
    if (lower.includes(phrase) && EXTENDED_SIZE_MAP[phrase]) {
      return EXTENDED_SIZE_MAP[phrase];
    }
  }

  for (const word of SIZE_SINGLE_WORD) {
    if (lower === word && EXTENDED_SIZE_MAP[word]) {
      return EXTENDED_SIZE_MAP[word];
    }
  }

  return null;
}

const EXTENDED_DECADE_MAP: Record<string, string> = {
  ...TYPED_DECADE_MAP,
  'y2k': "2000's",
  'early two thousands': "2000's",
  'late nineties': "90's",
  'early nineties': "90's",
};

export function parseDecade(text: string): string | null {
  const lower = text.toLowerCase().trim();
  if (lower === '') return null;

  if (EXTENDED_DECADE_MAP[lower]) return EXTENDED_DECADE_MAP[lower];

  for (const [key, value] of Object.entries(EXTENDED_DECADE_MAP)) {
    if (lower.includes(key)) return value;
  }

  // Match patterns like "90s", "90's", "80's". The 's' suffix is REQUIRED —
  // otherwise a bare two-digit price like "75" in "75 dollars" gets parsed
  // as the decade "75's" and the price scanner is left with no number to
  // expand backward into.
  const shortMatch = lower.match(/^(\d{2})['']?s$/);
  if (shortMatch) {
    const num = parseInt(shortMatch[1]);
    if (num >= 50 && num <= 99) return `${num}'s`;
    if (num >= 0 && num <= 20) return `${2000 + num}'s`;
  }

  const yearMatch = lower.match(/(\d{4})s?'?s?/);
  if (yearMatch) {
    const year = parseInt(yearMatch[1]);
    const decade = Math.floor(year / 10) * 10;
    if (decade >= 1950 && decade <= 2020) {
      return decade >= 2000 ? `${decade}'s` : `${decade - 1900}'s`;
    }
  }

  return null;
}

// ─── Filler-word filter for item-name extraction ─────────────────────────────

/**
 * Words that are nearly always disfluencies or grammatical glue rather than
 * part of the item description. They get stripped from item_name extraction
 * so transcripts like "its a large" or "I would say ninety dollars" don't
 * inject "Its A" or "I Would Say" as the item name.
 */
const FILLER_WORDS = new Set([
  'um', 'uh', 'er', 'ah', 'eh', 'mm', 'hmm',
  'a', 'an', 'the',
  'this', 'that', 'these', 'those',
  'is', 'was', 'are', 'were', 'be', 'been',
  'its', "it's", 'it',
  'my', 'your', 'his', 'her',
  'i', "i'd", "i'll", "i'm", "i've",
  'would', 'should', 'could',
  'say', 'said', 'think', 'thought', 'mean', 'guess',
  'really', 'just', 'maybe', 'literally', 'actually',
  'like', 'you', 'know',
  'from', 'of', 'with',
  'so', 'and', 'but',
  'nice', 'pretty',
  'kind', 'sort',
  'in', 'on',
  'about',
]);

function stripFillers(words: string[]): string[] {
  return words.filter((w) => {
    const cleaned = w.toLowerCase().replace(/[.,!?]/g, '');
    return cleaned !== '' && !FILLER_WORDS.has(cleaned);
  });
}

// ─── Top-level transcript parsers ────────────────────────────────────────────

const MAX_TRANSCRIPT_LENGTH = 1000;

/**
 * Parse a full spoken inventory entry into structured fields.
 * Handles both comma-separated and natural speech:
 *   "Medium, nineties, Polo Red Quilted Bomber, seventy-five dollars"
 *   "large 90s red Champion hoodie 74"
 *
 * Missing fields come back as `null`. Use {@link mergeItems} to combine
 * multiple parses across utterances.
 *
 * Operation order (this is what makes "nineties" stay a decade rather than
 * leaking into price):
 *   1. SIZE detected and the matched words added to a `consumed` set
 *   2. DECADE detected, matched words added to `consumed`
 *   3. PRICE detected, but only over words NOT in `consumed`
 *   4. Item name = remaining unconsumed words minus filler words
 */
export function parseTranscript(transcript: string): ParsedItem {
  const sanitized = transcript.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  const truncated = sanitized.length > MAX_TRANSCRIPT_LENGTH
    ? sanitized.slice(0, MAX_TRANSCRIPT_LENGTH)
    : sanitized;

  const cleaned = truncated.replace(/\s+/g, ' ').trim();

  if (cleaned === '') {
    return { ...EMPTY_ITEM, raw_transcript: '' };
  }

  let result: ParsedItem;
  if (cleaned.includes(',')) {
    const segmented = parseSegmented(cleaned);
    if (segmented.size !== null || segmented.decade !== null || segmented.price !== null) {
      result = segmented;
    } else {
      result = parseWordByWord(cleaned);
    }
  } else {
    result = parseWordByWord(cleaned);
  }

  result.raw_transcript = cleaned;

  // Step-by-step diagnostic so live runtime captures the same per-stage
  // visibility the unit tests have. Disabled when running under Jest so
  // test output stays clean.
  if (typeof process === 'undefined' || process.env.JEST_WORKER_ID === undefined) {
    console.log('[PARSER]', JSON.stringify({
      input: cleaned,
      size: result.size,
      decade: result.decade,
      price: result.price,
      item_name: result.item_name,
      confidence: result.confidence,
    }));
  }

  return result;
}

/** Backwards-compatible alias for the previous public name. */
export const parseTranscription = parseTranscript;

/**
 * Parse comma-separated input: "Medium, nineties, Polo Bomber, $75"
 */
function parseSegmented(cleaned: string): ParsedItem {
  const segments = cleaned
    .split(/[,;.]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);

  let size: string | null = null;
  let decade: string | null = null;
  let price: number | null = null;
  const claimed = new Set<number>();

  for (let i = 0; i < segments.length; i++) {
    const parsed = parseSize(segments[i]);
    if (parsed) { size = parsed; claimed.add(i); break; }
  }

  for (let i = 0; i < segments.length; i++) {
    if (claimed.has(i)) continue;
    const parsed = parseDecade(segments[i]);
    if (parsed) { decade = parsed; claimed.add(i); break; }
  }

  for (let i = segments.length - 1; i >= 0; i--) {
    if (claimed.has(i)) continue;
    if (!looksLikePrice(segments[i])) continue;
    const parsed = parsePrice(segments[i]);
    if (parsed !== null) { price = parsed; claimed.add(i); break; }
  }

  const itemNameParts: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    if (!claimed.has(i)) itemNameParts.push(segments[i]);
  }

  return buildResult(size, decade, price, itemNameParts.join(' '));
}

function looksLikePrice(segment: string): boolean {
  const lower = segment.toLowerCase();
  if (/\d/.test(lower)) return true;
  if (lower.includes('$')) return true;
  for (const w of lower.split(/[\s-]+/)) {
    if (PRICE_INDICATORS.has(w.replace(/[.,]/g, ''))) return true;
  }
  return false;
}

/**
 * Order-independent natural-speech parser.
 *
 *   1. Detect SIZE first (handles "size N" + multi-word phrases).
 *   2. Detect DECADE.
 *   3. Detect PRICE within unconsumed words (slang first, then indicator
 *      patterns, then bare numerics).
 *   4. Item name = remaining non-filler words.
 */
function parseWordByWord(text: string): ParsedItem {
  const words = text.split(/\s+/);
  let size: string | null = null;
  let decade: string | null = null;
  let price: number | null = null;
  const consumed = new Set<number>();

  // Slang prices first ("one fifty" / "two fifty" before any other detection)
  for (let i = 0; i < words.length - 1; i++) {
    if (consumed.has(i) || consumed.has(i + 1)) continue;
    const phrase = `${words[i]} ${words[i + 1]}`.toLowerCase().replace(/[.,]/g, '');
    if (PRICE_SLANG[phrase] !== undefined) {
      price = PRICE_SLANG[phrase];
      consumed.add(i); consumed.add(i + 1);
      break;
    }
  }

  // "size N" pattern
  for (let i = 0; i < words.length - 1; i++) {
    if (consumed.has(i) || consumed.has(i + 1)) continue;
    if (words[i].toLowerCase() !== 'size') continue;
    const next = words[i + 1].replace(/[^\d]/g, '');
    const num = parseInt(next, 10);
    if (!isNaN(num) && num > 0 && num <= 60) {
      size = String(num);
      consumed.add(i); consumed.add(i + 1);
      break;
    }
  }

  // Multi-word size, then single word
  if (size === null) {
    for (let i = 0; i < words.length; i++) {
      if (consumed.has(i)) continue;
      // 3-word
      if (i + 2 < words.length && !consumed.has(i + 1) && !consumed.has(i + 2)) {
        const three = `${words[i]} ${words[i + 1]} ${words[i + 2]}`.toLowerCase();
        if (EXTENDED_SIZE_MAP[three]) {
          size = EXTENDED_SIZE_MAP[three];
          consumed.add(i); consumed.add(i + 1); consumed.add(i + 2);
          break;
        }
      }
      // 2-word
      if (i + 1 < words.length && !consumed.has(i + 1)) {
        const two = `${words[i]} ${words[i + 1]}`.toLowerCase();
        if (EXTENDED_SIZE_MAP[two]) {
          size = EXTENDED_SIZE_MAP[two];
          consumed.add(i); consumed.add(i + 1);
          break;
        }
      }
      // Single word — only via parseSize (which checks against the SINGLE list)
      const parsed = parseSize(words[i]);
      if (parsed) {
        size = parsed;
        consumed.add(i);
        break;
      }
    }
  }

  // Decade — try 3-word and 2-word phrases via EXACT lookup against
  // EXTENDED_DECADE_MAP (parseDecade itself uses .includes() which is
  // unsafe for multi-word slices because "nineties Nike windbreaker"
  // would match "nineties" and consume the brand words too). Single
  // words still go through parseDecade for its regex patterns.
  for (let i = 0; i < words.length && decade === null; i++) {
    if (consumed.has(i)) continue;
    if (i + 2 < words.length && !consumed.has(i + 1) && !consumed.has(i + 2)) {
      const three = `${words[i]} ${words[i + 1]} ${words[i + 2]}`.toLowerCase();
      if (EXTENDED_DECADE_MAP[three]) {
        decade = EXTENDED_DECADE_MAP[three];
        consumed.add(i); consumed.add(i + 1); consumed.add(i + 2);
        break;
      }
    }
    if (i + 1 < words.length && !consumed.has(i + 1)) {
      const two = `${words[i]} ${words[i + 1]}`.toLowerCase();
      if (EXTENDED_DECADE_MAP[two]) {
        decade = EXTENDED_DECADE_MAP[two];
        consumed.add(i); consumed.add(i + 1);
        break;
      }
    }
    const parsed = parseDecade(words[i]);
    if (parsed) {
      decade = parsed;
      consumed.add(i);
      break;
    }
  }

  // Price
  if (price === null) {
    const priceMatch = detectPriceInWords(words, consumed);
    if (priceMatch) {
      price = priceMatch.value;
      for (let j = priceMatch.start; j <= priceMatch.end; j++) consumed.add(j);
    }
  }

  // Item name = remaining non-filler words
  const remaining: string[] = [];
  for (let i = 0; i < words.length; i++) {
    if (!consumed.has(i)) remaining.push(words[i]);
  }
  const meaningful = stripFillers(remaining);

  return buildResult(size, decade, price, meaningful.join(' '));
}

function isPriceNumberWord(raw: string): boolean {
  const w = raw.toLowerCase().replace(/[-,.]/g, '');
  if (w === 'and') return true;
  if (WORD_NUMBERS[w] !== undefined) return true;
  if (MULTIPLIERS[w] !== undefined) return true;
  if (/^\d+(?:\.\d{1,2})?$/.test(w)) return true;
  return false;
}

function detectPriceInWords(
  words: string[],
  consumed: Set<number>
): { value: number; start: number; end: number } | null {
  // Pattern A: "dollars"/"bucks" indicator — expand backward through number words
  for (let i = 0; i < words.length; i++) {
    if (consumed.has(i)) continue;
    const w = words[i].toLowerCase().replace(/[.,]/g, '');
    if (!PRICE_INDICATORS.has(w)) continue;

    let start = i;
    while (start > 0 && !consumed.has(start - 1) && isPriceNumberWord(words[start - 1])) {
      start--;
    }
    if (start < i) {
      const phrase = words.slice(start, i + 1).join(' ');
      const parsed = parsePrice(phrase);
      if (parsed !== null && parsed > 0) {
        return { value: parsed, start, end: i };
      }
    }
  }

  // Pattern B: $-prefixed token
  for (let i = 0; i < words.length; i++) {
    if (consumed.has(i)) continue;
    if (!words[i].startsWith('$')) continue;
    const cleaned = words[i].replace(/[$,]/g, '');
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num > 0) {
      return { value: num, start: i, end: i };
    }
  }

  // Pattern C: bare numeric token, optionally followed by "dollars"
  for (let i = words.length - 1; i >= 0; i--) {
    if (consumed.has(i)) continue;
    const cleaned = words[i].replace(/[$,]/g, '');
    if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) continue;
    const num = parseFloat(cleaned);
    if (num > 0) {
      let end = i;
      if (
        i + 1 < words.length &&
        !consumed.has(i + 1) &&
        PRICE_INDICATORS.has(words[i + 1].toLowerCase().replace(/[.,]/g, ''))
      ) {
        end = i + 1;
      }
      return { value: num, start: i, end };
    }
  }

  // Pattern D: a contiguous run of >=2 number-words with no indicator,
  // e.g. "forty five" → 45. The 2-word minimum stops single utterances
  // like "twenty" from being misread as a price.
  let runStart = -1;
  for (let i = 0; i <= words.length; i++) {
    const inRun = i < words.length && !consumed.has(i) && isPriceNumberWord(words[i]);
    if (inRun) {
      if (runStart === -1) runStart = i;
    } else if (runStart !== -1) {
      const runEnd = i - 1;
      if (runEnd - runStart >= 1) {
        const phrase = words.slice(runStart, runEnd + 1).join(' ');
        const parsed = parsePrice(phrase);
        if (parsed !== null && parsed > 0) {
          return { value: parsed, start: runStart, end: runEnd };
        }
      }
      runStart = -1;
    }
  }

  return null;
}

/**
 * Build the final ParsedItem from extracted fields.
 *
 * `itemName` here is whatever text was left after size/decade/price words
 * were claimed. Empty or filler-only input becomes `item_name: null`.
 */
function buildResult(
  size: string | null,
  decade: string | null,
  price: number | null,
  itemName: string
): ParsedItem {
  // Strip surrounding/trailing punctuation that web Speech APIs append.
  // Without this, "Nike Hoodie. Twenty five dollars" leaves "Nike Hoodie."
  // as the item name, including the period.
  const trimmed = itemName.trim().replace(/^[\s,.;!?]+|[\s,.;!?]+$/g, '');
  const item_name = trimmed.length > 0 ? titleCase(trimmed) : null;

  const confidence =
    (size !== null ? 25 : 0) +
    (decade !== null ? 25 : 0) +
    (price !== null ? 25 : 0) +
    (item_name !== null ? 25 : 0);

  const sizeDisplay = size ?? '?';
  const decadeDisplay = decade ?? '?';
  const nameDisplay = item_name ?? 'Unknown Item';

  return {
    size,
    decade,
    item_name,
    price,
    raw_title: `(${sizeDisplay}) ${decadeDisplay} ${nameDisplay}`,
    raw_transcript: '',
    confidence,
  };
}

function titleCase(str: string): string {
  return str
    .split(' ')
    .map((word) => {
      if (word.length === 0) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Split a continuous transcript into multiple inventory items.
 * Detects item boundaries by finding a price (number) followed by
 * a size word (which starts the next item).
 */
export function splitMultipleItems(transcript: string): string[] {
  const words = transcript.split(/\s+/);
  const sizeWords = new Set([
    'small', 'medium', 'large', 'xs', 'xl', 'xxl', '2xl',
    'extra',
  ]);

  const items: string[] = [];
  let currentStart = 0;
  let lastPriceEnd = -1;

  for (let i = 0; i < words.length; i++) {
    const word = words[i].toLowerCase().replace(/[$,]/g, '');

    const isNumber = !isNaN(parseFloat(word)) && parseFloat(word) > 0;
    const isPriceWord = ['dollars', 'dollar', 'bucks'].includes(word);

    if (isNumber || isPriceWord) {
      lastPriceEnd = i;
    }

    if (lastPriceEnd >= 0 && i > lastPriceEnd && sizeWords.has(word)) {
      const itemText = words.slice(currentStart, i).join(' ').trim();
      if (itemText) items.push(itemText);
      currentStart = i;
      lastPriceEnd = -1;
    }
  }

  const lastItem = words.slice(currentStart).join(' ').trim();
  if (lastItem) items.push(lastItem);

  return items;
}
