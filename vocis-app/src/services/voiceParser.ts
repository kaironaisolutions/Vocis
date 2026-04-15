import { SIZE_MAP, DECADE_MAP } from '../types';

export interface ParsedItem {
  size: string;
  decade: string;
  item_name: string;
  price: number;
  raw_title: string;
  confidence: {
    size: boolean;
    decade: boolean;
    price: boolean;
    item_name: boolean;
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
      return result;
    }
  }

  // Always try word-by-word parsing (handles natural speech)
  return parseWordByWord(cleaned);
}

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
    const parsed = parsePrice(segments[i]);
    if (parsed !== null) { price = parsed; claimed.add(i); break; }
  }

  const itemNameParts: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    if (!claimed.has(i)) itemNameParts.push(segments[i]);
  }

  return buildResult(size, decade, price, itemNameParts.join(' '));
}

/**
 * Parse natural speech word-by-word: "large 90s red Champion hoodie 74"
 * Scans for size, decade, and price tokens, everything else is item name.
 */
function parseWordByWord(text: string): ParsedItem {
  const words = text.split(/\s+/);
  let size: string | null = null;
  let decade: string | null = null;
  let price: number | null = null;
  const consumed = new Set<number>();

  // --- Find size (scan from start, check multi-word first) ---
  for (let i = 0; i < words.length; i++) {
    // Three-word: "xx large"
    if (i + 1 < words.length) {
      const twoWord = `${words[i]} ${words[i + 1]}`;
      const parsed = parseSize(twoWord);
      if (parsed) {
        size = parsed;
        consumed.add(i);
        consumed.add(i + 1);
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

  // --- Find decade (scan all words) ---
  for (let i = 0; i < words.length; i++) {
    if (consumed.has(i)) continue;
    const parsed = parseDecade(words[i]);
    if (parsed) {
      decade = parsed;
      consumed.add(i);
      break;
    }
  }

  // --- Find price (scan from end, try progressively longer phrases) ---
  // Try expanding from the end: "dollars", "five dollars", "seventy five dollars", etc.
  let bestPrice: number | null = null;
  let bestPriceStart = -1;
  let bestPriceEnd = -1;

  for (let startIdx = words.length - 1; startIdx >= 0; startIdx--) {
    // Skip consumed words
    if (consumed.has(startIdx)) break;

    const phrase = words.slice(startIdx, words.length).join(' ');
    const parsed = parsePrice(phrase);
    if (parsed !== null && parsed > (bestPrice ?? 0)) {
      bestPrice = parsed;
      bestPriceStart = startIdx;
      bestPriceEnd = words.length - 1;
    }
  }

  if (bestPrice !== null && bestPriceStart >= 0) {
    price = bestPrice;
    for (let j = bestPriceStart; j <= bestPriceEnd; j++) consumed.add(j);
  }

  // Fallback: scan for standalone numeric values
  if (price === null) {
    for (let i = words.length - 1; i >= 0; i--) {
      if (consumed.has(i)) continue;
      const word = words[i].replace(/[$,]/g, '');
      const num = parseFloat(word);
      if (!isNaN(num) && num > 0) {
        price = num;
        consumed.add(i);
        if (i + 1 < words.length && PRICE_INDICATORS.has(words[i + 1].toLowerCase())) {
          consumed.add(i + 1);
        }
        break;
      }
    }
  }

  // --- Everything remaining is the item name ---
  const nameParts: string[] = [];
  for (let i = 0; i < words.length; i++) {
    if (!consumed.has(i)) {
      nameParts.push(words[i]);
    }
  }

  return buildResult(size, decade, price, nameParts.join(' '));
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

  return {
    size: sizeDisplay,
    decade: decadeDisplay,
    item_name: name,
    price: priceValue,
    raw_title: `(${sizeDisplay}) ${decadeDisplay} ${name}`,
    confidence: {
      size: size !== null,
      decade: decade !== null,
      price: price !== null,
      item_name: itemName.trim().length > 0,
    },
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
