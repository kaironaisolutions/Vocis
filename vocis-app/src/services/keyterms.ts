import AsyncStorage from '@react-native-async-storage/async-storage';

const CUSTOM_KEYTERMS_KEY = 'vocis_custom_keyterms_v1';
const MAX_CUSTOM_KEYTERMS = 100;
const MAX_KEYTERM_LENGTH = 40;

/**
 * Built-in vintage-clothing vocabulary biased into the STT model so it
 * doesn't mishear domain terms ("Champion", "Carhartt", "burgundy", etc.).
 *
 * The list is intentionally focused: ElevenLabs treats keyterms as soft
 * biasing, and a long generic list dilutes the signal. Only words that
 * resellers actually say into the mic should be here.
 */
export const DEFAULT_KEYTERMS: readonly string[] = [
  // Sizes
  'XS', 'small', 'medium', 'large', 'XL', 'XXL', 'one size',
  // Decades
  'seventies', 'eighties', 'nineties', 'two thousands', 'Y2K',
  // Common brands
  'Levi', 'Levis', 'Wrangler', 'Lee', 'Dickies',
  'Ralph Lauren', 'Polo', 'Tommy Hilfiger', 'Tommy', 'Calvin Klein',
  'Nautica', 'Fila', 'Champion', 'Russell Athletic', 'Fruit of the Loom',
  'Carhartt', 'Pendleton', 'Patagonia', 'North Face',
  'Nike', 'Adidas', 'Reebok', 'Puma',
  'Starter', 'Apex', 'Logo Athletic',
  // Garments
  'windbreaker', 'bomber', 'flannel', 'denim', 'corduroy',
  'velour', 'velvet', 'knit', 'sweatshirt', 'hoodie',
  'crewneck', 'quarter zip', 'turtleneck', 'mock neck', 'henley',
  'graphic tee', 'band tee', 'vintage tee',
  'blazer', 'sport coat', 'vest',
  'trench coat', 'peacoat', 'overcoat',
  'straight leg', 'bootcut', 'flare', 'wide leg',
  'high waist', 'mom jeans', 'dad jeans',
  'cargo pants', 'chinos', 'slacks',
  'mini skirt', 'midi skirt', 'maxi skirt',
  'slip dress', 'wrap dress', 'shift dress',
  // Colors
  'burgundy', 'maroon', 'olive', 'mustard', 'teal', 'coral',
  'mauve', 'chartreuse', 'heather grey', 'heather gray', 'charcoal',
  'cream', 'ecru', 'ivory', 'off white',
  // Descriptors
  'distressed', 'faded', 'washed', 'raw hem',
  'embroidered', 'patchwork', 'plaid', 'striped',
  'floral', 'paisley', 'geometric', 'abstract',
  // Price words
  'dollars', 'bucks',
];

function sanitizeKeyterm(raw: string): string | null {
  const trimmed = raw.trim().replace(/[\x00-\x1F\x7F]/g, '');
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_KEYTERM_LENGTH) return trimmed.slice(0, MAX_KEYTERM_LENGTH);
  return trimmed;
}

export const KeytermsService = {
  /** Read the user-defined custom keyterms (in addition to defaults). */
  async getCustom(): Promise<string[]> {
    try {
      const raw = await AsyncStorage.getItem(CUSTOM_KEYTERMS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((s) => sanitizeKeyterm(String(s)))
        .filter((s): s is string => s !== null);
    } catch {
      return [];
    }
  },

  async setCustom(terms: string[]): Promise<void> {
    const cleaned = terms
      .map((t) => sanitizeKeyterm(t))
      .filter((s): s is string => s !== null)
      .slice(0, MAX_CUSTOM_KEYTERMS);
    await AsyncStorage.setItem(CUSTOM_KEYTERMS_KEY, JSON.stringify(cleaned));
  },

  /** Default + custom, deduplicated case-insensitively. */
  async getAll(): Promise<string[]> {
    const custom = await this.getCustom();
    const seen = new Set<string>();
    const out: string[] = [];
    for (const term of [...DEFAULT_KEYTERMS, ...custom]) {
      const k = term.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(term);
    }
    return out;
  },

  MAX_CUSTOM_KEYTERMS,
  MAX_KEYTERM_LENGTH,
};
