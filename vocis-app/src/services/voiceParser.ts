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

/**
 * Parse a spoken price string into a numeric value.
 * Handles: "seventy five dollars", "$75", "75 dollars", "seventy-five",
 * "one hundred twenty dollars", "two fifty" (250), etc.
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

    // Try parsing as number in case of mixed: "one fifty" edge cases
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
 * Extract size from a token, returning the normalized abbreviation.
 */
export function parseSize(text: string): string | null {
  const lower = text.toLowerCase().trim();

  // Direct lookup
  if (SIZE_MAP[lower]) return SIZE_MAP[lower];

  // Try matching multi-word sizes within the text
  const multiWordSizes = ['extra small', 'x small', 'extra large', 'x large', 'xx large', 'double xl'];
  for (const phrase of multiWordSizes) {
    if (lower.includes(phrase)) return SIZE_MAP[phrase]!;
  }

  // Single word match
  const singleWordSizes = ['small', 'medium', 'large', 'xs', 's', 'm', 'l', 'xl', 'xxl', '2xl'];
  for (const word of singleWordSizes) {
    if (lower === word) return SIZE_MAP[word]!;
  }

  return null;
}

/**
 * Extract decade from a token, returning the normalized form.
 */
export function parseDecade(text: string): string | null {
  const lower = text.toLowerCase().trim();

  // Direct lookup
  if (DECADE_MAP[lower]) return DECADE_MAP[lower];

  // Try matching within the text
  for (const [key, value] of Object.entries(DECADE_MAP)) {
    if (lower.includes(key)) return value;
  }

  // Match patterns like "1990s", "1980's"
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

/**
 * Parse a full spoken inventory entry into structured fields.
 * Expected pattern: SIZE → DECADE → ITEM NAME → PRICE
 * Example: "Medium, nineties, Polo Red Quilted Bomber, seventy-five dollars"
 */
export function parseTranscription(transcript: string): ParsedItem {
  // Normalize input: remove extra whitespace, normalize punctuation
  const cleaned = transcript
    .replace(/\s+/g, ' ')
    .replace(/,\s*/g, ', ')
    .trim();

  // Split on commas or natural pauses (periods, semicolons)
  const segments = cleaned
    .split(/[,;.]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  let size: string | null = null;
  let decade: string | null = null;
  let price: number | null = null;
  let itemNameParts: string[] = [];

  // Track which segments have been claimed
  const claimed = new Set<number>();

  // Pass 1: Find size (usually first segment)
  for (let i = 0; i < segments.length; i++) {
    const parsed = parseSize(segments[i]);
    if (parsed) {
      size = parsed;
      claimed.add(i);
      break;
    }
  }

  // Pass 2: Find decade (usually second segment)
  for (let i = 0; i < segments.length; i++) {
    if (claimed.has(i)) continue;
    const parsed = parseDecade(segments[i]);
    if (parsed) {
      decade = parsed;
      claimed.add(i);
      break;
    }
  }

  // Pass 3: Find price (usually last segment)
  for (let i = segments.length - 1; i >= 0; i--) {
    if (claimed.has(i)) continue;
    const parsed = parsePrice(segments[i]);
    if (parsed !== null) {
      price = parsed;
      claimed.add(i);
      break;
    }
  }

  // Pass 4: Everything unclaimed is the item name
  for (let i = 0; i < segments.length; i++) {
    if (!claimed.has(i)) {
      itemNameParts.push(segments[i]);
    }
  }

  // If we couldn't segment properly, try word-by-word parsing on the full string
  if (size === null && decade === null && price === null) {
    const result = parseUnstructured(cleaned);
    size = result.size;
    decade = result.decade;
    price = result.price;
    itemNameParts = result.itemNameParts;
  }

  const item_name = itemNameParts.join(' ').trim() || 'Unknown Item';
  const sizeDisplay = size || '?';
  const decadeDisplay = decade || '?';
  const priceValue = price ?? 0;

  return {
    size: sizeDisplay,
    decade: decadeDisplay,
    item_name: titleCase(item_name),
    price: priceValue,
    raw_title: `(${sizeDisplay}) ${decadeDisplay} ${titleCase(item_name)}`,
    confidence: {
      size: size !== null,
      decade: decade !== null,
      price: price !== null,
      item_name: itemNameParts.length > 0,
    },
  };
}

/**
 * Fallback parser for unstructured speech without clear comma separation.
 * Scans word-by-word to extract fields.
 */
function parseUnstructured(text: string): {
  size: string | null;
  decade: string | null;
  price: number | null;
  itemNameParts: string[];
} {
  const words = text.split(/\s+/);
  let size: string | null = null;
  let decade: string | null = null;
  let price: number | null = null;
  const consumedRanges: [number, number][] = [];

  // Scan for size (check multi-word first)
  for (let i = 0; i < words.length; i++) {
    // Two-word sizes
    if (i + 1 < words.length) {
      const twoWord = `${words[i]} ${words[i + 1]}`;
      const parsed = parseSize(twoWord);
      if (parsed) {
        size = parsed;
        consumedRanges.push([i, i + 1]);
        break;
      }
    }
    // Single-word sizes
    const parsed = parseSize(words[i]);
    if (parsed) {
      size = parsed;
      consumedRanges.push([i, i]);
      break;
    }
  }

  // Scan for decade
  for (let i = 0; i < words.length; i++) {
    if (isConsumed(i, consumedRanges)) continue;
    const parsed = parseDecade(words[i]);
    if (parsed) {
      decade = parsed;
      consumedRanges.push([i, i]);
      break;
    }
  }

  // Scan for price from the end
  for (let i = words.length - 1; i >= 0; i--) {
    if (isConsumed(i, consumedRanges)) continue;
    // Try multi-word price: "seventy five dollars"
    const remaining = words.slice(i).join(' ');
    const parsed = parsePrice(remaining);
    if (parsed !== null) {
      price = parsed;
      consumedRanges.push([i, words.length - 1]);
      break;
    }
  }

  // Collect remaining words as item name
  const itemNameParts: string[] = [];
  for (let i = 0; i < words.length; i++) {
    if (!isConsumed(i, consumedRanges)) {
      itemNameParts.push(words[i]);
    }
  }

  return { size, decade, price, itemNameParts };
}

function isConsumed(index: number, ranges: [number, number][]): boolean {
  return ranges.some(([start, end]) => index >= start && index <= end);
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
