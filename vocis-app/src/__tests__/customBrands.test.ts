jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  learnBrand,
  addBrand,
  removeBrand,
  clearBrands,
  getCustomBrands,
  extractBrandWord,
  MAX_CUSTOM_BRANDS,
  MAX_BRAND_LENGTH,
} from '../services/customBrands';

const STORAGE_KEY = 'vocis_custom_keyterms_v1';

beforeEach(async () => {
  await AsyncStorage.clear();
});

// ── extractBrandWord ─────────────────────────────────────────────────────────

describe('extractBrandWord', () => {
  it('extracts the first meaningful word', () => {
    expect(extractBrandWord('Stussy Hoodie')).toBe('Stussy');
    expect(extractBrandWord('Vintage Stussy Hoodie')).toBe('Stussy');
    expect(extractBrandWord('Vintage 90s Stussy World Tour Tee')).toBe('Stussy');
  });

  it('skips garments, sizes, colors, materials, descriptors', () => {
    expect(extractBrandWord('Large Denim Jacket')).toBeNull();
    expect(extractBrandWord('Leather Bomber')).toBeNull();
    expect(extractBrandWord('Red Plaid Flannel Shirt')).toBeNull();
    expect(extractBrandWord('Vintage Distressed Tee')).toBeNull();
  });

  it('skips number-led tokens (decades, waist sizes, models)', () => {
    expect(extractBrandWord('90s Hoodie')).toBeNull();
    expect(extractBrandWord('34x30 Carpenter Pants')).toBeNull();
    expect(extractBrandWord('501 Jeans')).toBeNull();
  });

  it('returns null when the brand is already in the base keyterm list', () => {
    expect(extractBrandWord('Carhartt Detroit Jacket')).toBeNull();
    expect(extractBrandWord('North Face Puffer')).toBeNull();
    expect(extractBrandWord('Vintage Polo Bomber')).toBeNull();
  });

  it('skips words over the 20-char keyterm limit', () => {
    expect(
      extractBrandWord('Supercalifragilisticexpialidocious Stussy Tee')
    ).toBe('Stussy');
  });

  it('keeps brand-internal punctuation and unicode', () => {
    expect(extractBrandWord('Stüssy hoodie')).toBe('Stüssy');
    expect(extractBrandWord('(Avirex) jacket')).toBe('Avirex');
  });
});

// ── learnBrand ───────────────────────────────────────────────────────────────

describe('learnBrand', () => {
  it('learns and persists a brand from an item name', async () => {
    const learned = await learnBrand('Vintage Avirex Leather Jacket');
    expect(learned).toBe('Avirex');
    expect(await getCustomBrands()).toEqual(['Avirex']);
  });

  it('returns null and stores nothing for skip-word-only names', async () => {
    expect(await learnBrand('Large Denim Jacket')).toBeNull();
    expect(await learnBrand('')).toBeNull();
    expect(await getCustomBrands()).toEqual([]);
  });

  it('dedupes case-insensitively', async () => {
    await learnBrand('Stussy hoodie');
    await learnBrand('STUSSY jacket');
    await learnBrand('stussy tee');
    expect(await getCustomBrands()).toEqual(['Stussy']);
  });

  it('re-learning refreshes recency (moves brand to the front)', async () => {
    await learnBrand('Avirex jacket');
    await learnBrand('Stussy hoodie');
    await learnBrand('Avirex bomber');
    expect(await getCustomBrands()).toEqual(['Avirex', 'Stussy']);
  });

  it(`caps at ${MAX_CUSTOM_BRANDS}, keeping the most recent`, async () => {
    for (let i = 0; i < MAX_CUSTOM_BRANDS + 5; i++) {
      await learnBrand(`Brandno${i} jacket`);
    }
    const brands = await getCustomBrands();
    expect(brands).toHaveLength(MAX_CUSTOM_BRANDS);
    // Most recent first; the 5 oldest were evicted.
    expect(brands[0]).toBe(`Brandno${MAX_CUSTOM_BRANDS + 4}`);
    expect(brands).not.toContain('Brandno0');
    expect(brands).not.toContain('Brandno4');
    expect(brands).toContain('Brandno5');
  });

  it('never learns base-keyterm brands', async () => {
    expect(await learnBrand('Carhartt Detroit Jacket')).toBeNull();
    expect(await getCustomBrands()).toEqual([]);
  });
});

// ── addBrand (manual) ────────────────────────────────────────────────────────

describe('addBrand', () => {
  it('adds the exact text, keeping multi-word brands whole', async () => {
    const next = await addBrand('Members Only');
    expect(next).toEqual(['Members Only']);
    expect(await getCustomBrands()).toEqual(['Members Only']);
  });

  it(`rejects input over ${MAX_BRAND_LENGTH} chars, list unchanged`, async () => {
    await addBrand('Avirex');
    const next = await addBrand('X'.repeat(MAX_BRAND_LENGTH + 1));
    expect(next).toEqual(['Avirex']);
  });

  it('rejects empty/whitespace input', async () => {
    expect(await addBrand('   ')).toEqual([]);
  });

  it('dedupes case-insensitively against learned brands', async () => {
    await learnBrand('Avirex jacket');
    const next = await addBrand('AVIREX');
    expect(next).toHaveLength(1);
  });
});

// ── removeBrand / clearBrands ────────────────────────────────────────────────

describe('removeBrand / clearBrands', () => {
  it('removes case-insensitively', async () => {
    await addBrand('Avirex');
    await addBrand('Stussy');
    const next = await removeBrand('avirex');
    expect(next).toEqual(['Stussy']);
    expect(await getCustomBrands()).toEqual(['Stussy']);
  });

  it('clearBrands empties the list', async () => {
    await addBrand('Avirex');
    await clearBrands();
    expect(await getCustomBrands()).toEqual([]);
  });
});

// ── legacy KeytermsService data migration ────────────────────────────────────

describe('legacy storage migration', () => {
  it('preserves old custom keyterms within the new limits', async () => {
    // KeytermsService allowed up to 100 terms / 40 chars on the same key.
    const legacy = [
      'Stussy',
      'A'.repeat(30), // over the new 20-char limit — dropped
      'Members Only',
      ...Array.from({ length: 30 }, (_, i) => `Legacy${i}`),
    ];
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));

    const brands = await getCustomBrands();
    expect(brands[0]).toBe('Stussy');
    expect(brands).toContain('Members Only');
    expect(brands).not.toContain('A'.repeat(30));
    expect(brands.length).toBeLessThanOrEqual(MAX_CUSTOM_BRANDS);
  });

  it('survives corrupt storage', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, 'not json {{{');
    expect(await getCustomBrands()).toEqual([]);
    await AsyncStorage.setItem(STORAGE_KEY, '"a string"');
    expect(await getCustomBrands()).toEqual([]);
  });
});
