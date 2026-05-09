import { SIZE_MAP, DECADE_MAP } from '../types';

export interface ParsedItem {
  size: string;
  decade: string;
  item_name: string;
  price: number;
  raw_title: string;
  /** The original transcript text we parsed — what the user actually said. */
  raw_transcript: string;
  confidence: {
    size: boolean;
    decade: boolean;
    price: boolean;
    item_name: boolean;
  };
  confidence_score: number;
}

/** 0–100 score: 25 points per detected field. */
export function getConfidenceScore(item: ParsedItem): number {
  return item.confidence_score;
}

/**
 * Merge two parsed items, keeping each field that the existing item already
 * has unless the incoming transcript actually detected a new value for it.
 *
 * The decision is driven by the per-field confidence flags — not by checking
 * for the placeholder values ('?', 'Unknown Item', 0) — so we never overwrite
 * a real "Nike hoodie" with the placeholder "Unknown Item" coming back from
 * a follow-up utterance like "small".
 *
 * raw_transcript always reflects the most recent transcript, so the
 * "what was heard" reveal shows the latest words the user spoke.
 */
export function mergeItems(existing: ParsedItem, incoming: ParsedItem): ParsedItem {
  const size = incoming.confidence.size ? incoming.size : existing.size;
  const decade = incoming.confidence.decade ? incoming.decade : existing.decade;
  const price = incoming.confidence.price ? incoming.price : existing.price;
  const item_name = incoming.confidence.item_name ? incoming.item_name : existing.item_name;

  const confidence = {
    size: existing.confidence.size || incoming.confidence.size,
    decade: existing.confidence.decade || incoming.confidence.decade,
    price: existing.confidence.price || incoming.confidence.price,
    item_name: existing.confidence.item_name || incoming.confidence.item_name,
  };

  const confidence_score =
    (confidence.size ? 25 : 0) +
    (confidence.decade ? 25 : 0) +
    (confidence.price ? 25 : 0) +
    (confidence.item_name ? 25 : 0);

  const sizeDisplay = confidence.size ? size : '?';
  const decadeDisplay = confidence.decade ? decade : '?';

  return {
    size: sizeDisplay,
    decade: decadeDisplay,
    item_name,
    price,
    raw_title: `(${sizeDisplay}) ${decadeDisplay} ${item_name}`,
    raw_transcript: incoming.raw_transcript || existing.raw_transcript,
    confidence,
    confidence_score,
  };
}

// Word-to-number mapping for spoken prices
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

// Words that indicate price follows
const PRICE_INDICATORS = new Set(['dollars', 'dollar', 'bucks', 'buck']);

/**
 * Parse a spoken price string into a numeric value.
 * Handles: "seventy five dollars", "$75", "75 dollars", "seventy-five",
 * "one hundred twenty dollars", "74.00", etc.
 */
export function parsePrice(text: string): number | null {
  const cleaned = text.toLowerCase().replace(/dollars?|bucks?|\$/g, '').trim();

  // Try direct numeric parse first: "75", "75.00", "12.50"
  const directNum = parseFloat(cleaned.replace(/,/g, ''));
  if (!isNaN(directNum) && directNum > 0) return directNum;

  // Parse word-based numbers
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
 * Extract size from a single token or short phrase.
 */
export function parseSize(text: string): string | null {
  const lower = text.toLowerCase().trim();

  if (SIZE_MAP[lower]) return SIZE_MAP[lower];

  const multiWordSizes = ['extra small', 'x small', 'extra large', 'x large', 'xx large', 'double xl'];
  for (const phrase of multiWordSizes) {
    if (lower.includes(phrase)) return SIZE_MAP[phrase]!;
  }

  const singleWordSizes = ['small', 'medium', 'large', 'xs', 's', 'm', 'l', 'xl', 'xxl', '2xl'];
  for (const word of singleWordSizes) {
    if (lower === word) return SIZE_MAP[word]!;
  }

  return null;
}

/**
 * Extract decade from a token.
 */
export function parseDecade(text: string): string | null {
  const lower = text.toLowerCase().trim();

  if (DECADE_MAP[lower]) return DECADE_MAP[lower];

  for (const [key, value] of Object.entries(DECADE_MAP)) {
    if (lower.includes(key)) return value;
  }

  // Match patterns like "90s", "90's", "1990s"
  const shortMatch = lower.match(/^(\d{2})s?'?s?$/);
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

// Maximum input length to prevent DoS
const MAX_TRANSCRIPT_LENGTH = 1000;

/**
 * Parse a full spoken inventory entry into structured fields.
 * Handles both comma-separated and natural speech:
 *   "Medium, nineties, Polo Red Quilted Bomber, seventy-five dollars"
 *   "large 90s red Champion hoodie 74"
 */
export function parseTranscription(transcript: string): ParsedItem {
  // Strip control characters before any processing to prevent UI corruption
  const sanitized = transcript.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  const truncated = sanitized.length > MAX_TRANSCRIPT_LENGTH
    ? sanitized.slice(0, MAX_TRANSCRIPT_LENGTH)
    : sanitized;

  const cleaned = truncated.replace(/\s+/g, ' ').trim();

  // Check if input has commas — if so, try segment-based parsing first
  if (cleaned.includes(',')) {
    const result = parseSegmented(cleaned);
    if (result.confidence.size || result.confidence.decade || result.confidence.price) {
      result.raw_transcript = cleaned;
      return result;
    }
  }

  // Always try word-by-word parsing (handles natural speech)
  const result = parseWordByWord(cleaned);
  result.raw_transcript = cleaned;
  return result;
}

/**
 * Parse comma-separated input: "Medium, nineties, Polo Bomber, $75"
 *
 * Each segment is examined independently — the parser does not assume
 * size-first / decade-second / price-last ordering.
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

  // Price segment: must look like a price (contains digits, $, or
  // dollars/bucks indicator) to avoid eating an item-name segment that
  // happens to contain a number-word like "seventy".
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

/** True if a segment contains digits, $, or a price indicator word. */
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
 * Parse natural speech word-by-word — order-independent.
 *
 * Each field is detected by content, not position:
 *   "Medium nineties Polo seventy-five dollars"  ✓
 *   "seventy-five dollars medium nineties Polo"  ✓
 *   "nineties Polo fifty dollars large"          ✓
 *
 * Strategy:
 *   1. Detect SIZE first (handles "size N" + multi-word phrases).
 *   2. Detect DECADE.
 *   3. Detect PRICE within contiguous spans of words that haven't
 *      already been claimed by size/decade. This is what makes price
 *      detection insensitive to where the price falls in the sentence.
 *   4. Item name = whatever is left over.
 */
function parseWordByWord(text: string): ParsedItem {
  const words = text.split(/\s+/);
  let size: string | null = null;
  let decade: string | null = null;
  let price: number | null = null;
  const consumed = new Set<number>();

  // --- Size: "size N" pattern, then multi-word, then single-word ---
  for (let i = 0; i < words.length - 1; i++) {
    if (words[i].toLowerCase() !== 'size') continue;
    const next = words[i + 1].replace(/[^\d]/g, '');
    const num = parseInt(next, 10);
    if (!isNaN(num) && num > 0 && num <= 60) {
      size = String(num);
      consumed.add(i);
      consumed.add(i + 1);
      break;
    }
  }

  if (size === null) {
    for (let i = 0; i < words.length; i++) {
      if (consumed.has(i)) continue;
      // 2-word phrase ("extra large", "xx large", "double xl")
      if (i + 1 < words.length && !consumed.has(i + 1)) {
        const two = `${words[i]} ${words[i + 1]}`;
        const parsed = parseSize(two);
        if (parsed) {
          size = parsed;
          consumed.add(i); consumed.add(i + 1);
          break;
        }
      }
      // Single word
      const parsed = parseSize(words[i]);
      if (parsed) {
        size = parsed;
        consumed.add(i);
        break;
      }
    }
  }

  // --- Decade ---
  for (let i = 0; i < words.length; i++) {
    if (consumed.has(i)) continue;
    const parsed = parseDecade(words[i]);
    if (parsed) {
      decade = parsed;
      consumed.add(i);
      break;
    }
  }

  // --- Price: scan unconsumed runs, never break on a consumed gap ---
  const priceMatch = detectPriceInWords(words, consumed);
  if (priceMatch) {
    price = priceMatch.value;
    for (let j = priceMatch.start; j <= priceMatch.end; j++) consumed.add(j);
  }

  // --- Item name = remaining words ---
  const nameParts: string[] = [];
  for (let i = 0; i < words.length; i++) {
    if (!consumed.has(i)) nameParts.push(words[i]);
  }

  return buildResult(size, decade, price, nameParts.join(' '));
}

/** Token classification for price phrase expansion. */
function isPriceNumberWord(raw: string): boolean {
  const w = raw.toLowerCase().replace(/[-,.]/g, '');
  if (w === 'and') return true;
  if (WORD_NUMBERS[w] !== undefined) return true;
  if (MULTIPLIERS[w] !== undefined) return true;
  if (/^\d+(?:\.\d{1,2})?$/.test(w)) return true;
  return false;
}

/**
 * Locate a price phrase among the unconsumed words.
 *
 * Three patterns, in priority order:
 *   A. A "dollars"/"bucks" word with number-words expanding backward through
 *      adjacent unconsumed positions.   ("seventy five dollars")
 *   B. A "$NN" / "$NN.NN" token.        ("$25")
 *   C. A bare numeric token, optionally followed by "dollars".  ("75")
 *
 * Returns the matched value plus the word range to consume, or null.
 */
function detectPriceInWords(
  words: string[],
  consumed: Set<number>
): { value: number; start: number; end: number } | null {
  // Pattern A: scan all words for price indicator
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

  // Pattern C: bare numeric token (scan from end so trailing prices win)
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

  return null;
}

/**
 * Build the final ParsedItem from extracted fields.
 */
function buildResult(
  size: string | null,
  decade: string | null,
  price: number | null,
  itemName: string
): ParsedItem {
  const name = titleCase(itemName.trim()) || 'Unknown Item';
  const sizeDisplay = size || '?';
  const decadeDisplay = decade || '?';
  const priceValue = price ?? 0;

  const confidence = {
    size: size !== null,
    decade: decade !== null,
    price: price !== null,
    item_name: itemName.trim().length > 0,
  };

  const confidence_score =
    (confidence.size ? 25 : 0) +
    (confidence.decade ? 25 : 0) +
    (confidence.price ? 25 : 0) +
    (confidence.item_name ? 25 : 0);

  return {
    size: sizeDisplay,
    decade: decadeDisplay,
    item_name: name,
    price: priceValue,
    raw_title: `(${sizeDisplay}) ${decadeDisplay} ${name}`,
    raw_transcript: '',
    confidence,
    confidence_score,
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
 *
 * Example: "large 90s red champion hoodie 74 medium nineties polo bomber 75"
 *  → ["large 90s red champion hoodie 74", "medium nineties polo bomber 75"]
 */
export function splitMultipleItems(transcript: string): string[] {
  const words = transcript.split(/\s+/);
  const sizeWords = new Set([
    'small', 'medium', 'large', 'xs', 'xl', 'xxl', '2xl',
    'extra', // "extra large" — next word check handles this
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

    // A size word after a price means a new item is starting
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
