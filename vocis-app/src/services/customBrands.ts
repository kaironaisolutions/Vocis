import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Custom Brands — user-taught brand vocabulary for STT keyterm biasing.
 *
 * ElevenLabs caps keyterm biasing at 50 terms per session (≤20 chars each).
 * The Cloudflare Worker owns the 49-term base list (PRIORITY_KEYTERMS in
 * worker/src/index.ts); this service manages up to 20 user-specific brands
 * that the app sends as repeated `keyterms=` params on the /stream URL.
 * The Worker merges them custom-first, then fills the remaining slots from
 * the base list — so core brands (Carhartt, Nike, Polo) are never pushed out.
 *
 * Brands are learned two ways:
 *   1. Automatically — when the user corrects an item name on the session
 *      review screen, learnBrand() extracts the likely brand word.
 *   2. Manually — the Custom Brands section in Settings calls addBrand().
 *
 * Privacy: brands live in AsyncStorage on the device and travel only as
 * keyterm params on the existing Worker WebSocket URL.
 *
 * Storage key is inherited from the retired KeytermsService so brands the
 * user added under the old "Voice Keyterms" UI are preserved. Reads apply
 * the new limits (20 terms / 20 chars), silently migrating legacy data.
 */

const CUSTOM_BRANDS_KEY = 'vocis_custom_keyterms_v1';

export const MAX_CUSTOM_BRANDS = 20;
export const MAX_BRAND_LENGTH = 20;

/**
 * Words that are never brands — garment types, materials, colors, sizes,
 * descriptors, and glue words that show up in item names around the brand.
 */
const SKIP_WORDS = new Set([
  // Glue / descriptors
  'vintage', 'retro', 'deadstock', 'rare', 'authentic', 'original',
  'genuine', 'classic', 'distressed', 'faded', 'washed', 'worn',
  'new', 'old', 'nice', 'great', 'unknown', 'item',
  'the', 'a', 'an', 'and', 'or', 'with', 'for', 'of',
  'mens', 'men', 'man', 'womens', 'women', 'woman', 'ladies',
  'unisex', 'kids', 'youth', 'big', 'tall', 'slim', 'regular',
  'oversized', 'boxy', 'cropped', 'baggy', 'wide', 'straight',
  'relaxed', 'fit', 'fits', 'made', 'usa', 'japan',
  'lightweight', 'heavyweight', 'heavy', 'light',
  'long', 'short', 'sleeve', 'sleeved', 'longsleeve',
  'lined', 'hooded', 'single', 'double', 'knee',
  'pocket', 'stitch', 'leg', 'waist', 'inseam',
  // Sizes
  'small', 'medium', 'large', 'extra', 'size',
  'xs', 's', 'm', 'l', 'xl', 'xxl', 'xxxl', 'os',
  // Decades (digit forms like "90s" are blocked by the leading-digit rule)
  'fifties', 'sixties', 'seventies', 'eighties', 'nineties',
  'thousands', 'y2k',
  // Garment types
  'jacket', 'sweater', 'shirt', 'tee', 'tshirt', 't-shirt', 'jeans',
  'knit', 'coat', 'crewneck', 'hat', 'cap', 'beanie', 'trucker',
  'vest', 'bomber', 'chore', 'shorts', 'pants', 'windbreaker',
  'harrington', 'barn', 'cardigan', 'flannel', 'button', 'up',
  'carpenter', 'carpenters', 'blazer', 'pullover', 'puffer',
  'jersey', 'varsity', 'biker', 'work', 'flight', 'rugby', 'track',
  'hoodie', 'sweatshirt', 'sweatpants', 'overalls', 'trousers',
  'slacks', 'bell', 'bottom', 'bottoms', 'bootcut', 'quarter',
  'half', 'zip', 'henley', 'turtleneck', 'anorak', 'parka',
  'dress', 'skirt', 'top', 'blouse', 'shacket', 'jumper',
  // Materials
  'leather', 'suede', 'wool', 'cotton', 'denim', 'linen', 'silk',
  'rayon', 'corduroy', 'velour', 'sherpa', 'fleece', 'cableknit',
  'quilted', 'nylon', 'polyester', 'canvas', 'mesh', 'satin',
  'velvet', 'mohair', 'cashmere',
  // Patterns
  'striped', 'plaid', 'patterned', 'floral', 'camo', 'embroidered',
  'reversible', 'argyle', 'paisley', 'checkered', 'colorblock',
  'patchwork', 'graphic', 'print', 'printed', 'logo', 'spellout',
  // Colors
  'red', 'blue', 'green', 'black', 'white', 'grey', 'gray', 'brown',
  'tan', 'navy', 'olive', 'moss', 'butter', 'cream', 'burgundy',
  'maroon', 'teal', 'charcoal', 'mauve', 'rust', 'sage', 'forest',
  'yellow', 'orange', 'purple', 'pink', 'beige', 'khaki', 'gold',
  'silver',
  // Price words
  'dollars', 'dollar', 'bucks', 'buck', 'usd', 'price',
]);

/**
 * Words of brands the Worker already biases for (mirrors the brand section
 * of PRIORITY_KEYTERMS in worker/src/index.ts, split into individual
 * words). Learning these would waste a custom slot — the base list covers
 * them on every session. A stale mirror only costs one wasted slot, never
 * correctness.
 */
const BASE_KEYTERM_BRAND_WORDS = new Set([
  'carhartt', 'patagonia', 'woolrich', 'pendleton', 'dickies',
  'wrangler', 'polo', 'nike', 'nautica', 'tommy', 'hilfiger',
  'levis', 'levi', "levi's", 'eddie', 'bauer', 'harley', 'davidson',
  'north', 'face', 'columbia', 'll', 'bean', 'filson', 'lands',
  'end', 'coogi', 'quiksilver', 'champion', 'lee', 'ralph',
  'lauren', 'gap', 'starter', 'fubu', 'karl', 'kani', 'rocawear',
  'nascar',
]);

/** Strip outer punctuation while keeping brand-internal chars (Levi's, L.L.). */
function cleanWord(raw: string): string {
  return raw.replace(/^[^\p{L}\p{N}'&.]+|[^\p{L}\p{N}'&.]+$/gu, '');
}

/**
 * Extract the likely brand word from an item name: the first word that
 * isn't a known descriptor/garment/size/color, isn't number-led ("90s",
 * "34x30"), and fits the 20-char keyterm limit. Returns null when the
 * first candidate is a brand the base keyterm list already covers — in
 * that case there's nothing new to learn.
 */
export function extractBrandWord(itemName: string): string | null {
  for (const raw of itemName.split(/\s+/)) {
    const word = cleanWord(raw);
    if (word.length < 2 || word.length > MAX_BRAND_LENGTH) continue;
    if (!/\p{L}/u.test(word)) continue;
    if (/^\d/.test(word)) continue;
    const lower = word.toLowerCase();
    if (SKIP_WORDS.has(lower)) continue;
    if (BASE_KEYTERM_BRAND_WORDS.has(lower)) return null;
    return word;
  }
  return null;
}

function sanitizeBrand(raw: string): string | null {
  const trimmed = raw.trim().replace(/[\x00-\x1F\x7F]/g, '');
  if (trimmed.length === 0 || trimmed.length > MAX_BRAND_LENGTH) return null;
  return trimmed;
}

async function persist(brands: string[]): Promise<void> {
  await AsyncStorage.setItem(CUSTOM_BRANDS_KEY, JSON.stringify(brands));
}

/**
 * Read the stored custom brands, most recently learned first.
 * Applies current limits on read, which filters legacy KeytermsService
 * data (up to 100 terms / 40 chars) down to the new limits; the filtered
 * list is written back on the next add/learn/remove.
 */
export async function getCustomBrands(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(CUSTOM_BRANDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((b) => sanitizeBrand(String(b)))
      .filter((b): b is string => b !== null)
      .slice(0, MAX_CUSTOM_BRANDS);
  } catch {
    return [];
  }
}

/**
 * Dedupe (case-insensitive), put `brand` first, cap, persist.
 * When the brand is already known, its stored casing wins — a lowercase
 * re-learn ("stussy tee") must not downgrade a deliberate "Stussy".
 */
async function upsertBrand(brand: string): Promise<string[]> {
  const existing = await getCustomBrands();
  const lower = brand.toLowerCase();
  const known = existing.find((b) => b.toLowerCase() === lower);
  const next = [
    known ?? brand,
    ...existing.filter((b) => b.toLowerCase() !== lower),
  ].slice(0, MAX_CUSTOM_BRANDS);
  await persist(next);
  return next;
}

/**
 * Learn a brand from a (corrected) item name. Fire-and-forget safe — never
 * throws, returns the learned brand or null when nothing was learnable.
 * Re-learning an existing brand refreshes its recency so frequently-used
 * brands aren't evicted by the cap.
 */
export async function learnBrand(itemName: string): Promise<string | null> {
  try {
    if (!itemName) return null;
    const brand = extractBrandWord(itemName);
    if (!brand) return null;
    const next = await upsertBrand(brand);
    console.log(`[BRANDS] Learned "${brand}" (${next.length}/${MAX_CUSTOM_BRANDS})`);
    return brand;
  } catch {
    return null;
  }
}

/**
 * Manually add a brand exactly as typed (multi-word brands like
 * "Members Only" are kept whole — no first-word extraction).
 * Returns the updated list; invalid input leaves the list unchanged.
 */
export async function addBrand(name: string): Promise<string[]> {
  try {
    const brand = sanitizeBrand(name);
    if (!brand) return getCustomBrands();
    return upsertBrand(brand);
  } catch {
    return [];
  }
}

/** Remove a brand (case-insensitive). Returns the updated list. */
export async function removeBrand(name: string): Promise<string[]> {
  try {
    const existing = await getCustomBrands();
    const next = existing.filter(
      (b) => b.toLowerCase() !== name.trim().toLowerCase()
    );
    await persist(next);
    return next;
  } catch {
    return [];
  }
}

/** Remove all custom brands. */
export async function clearBrands(): Promise<void> {
  try {
    await AsyncStorage.removeItem(CUSTOM_BRANDS_KEY);
  } catch {
    // Best-effort — a failed clear leaves brands in place, which is safe.
  }
}
