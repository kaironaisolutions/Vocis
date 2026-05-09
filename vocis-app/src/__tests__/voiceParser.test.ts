import {
  parseTranscript,
  mergeItems,
  EMPTY_ITEM,
  parsePrice,
  parseSize,
  parseDecade,
  ParsedItem,
} from '../services/voiceParser';

// ── HELPER ──────────────────────────────────────────────────────────────────

function buildItemFromTranscripts(...transcripts: string[]): ParsedItem {
  return transcripts.reduce<ParsedItem>(
    (item, text) => mergeItems(item, parseTranscript(text)),
    { ...EMPTY_ITEM }
  );
}

// ── UNIT: small parsers (kept for backwards compat with old call sites) ─────

describe('parsePrice', () => {
  it('parses numeric prices', () => {
    expect(parsePrice('75')).toBe(75);
    expect(parsePrice('75.00')).toBe(75);
    expect(parsePrice('12.50')).toBe(12.5);
    expect(parsePrice('$75')).toBe(75);
    expect(parsePrice('$120.00')).toBe(120);
  });

  it('parses word-based prices', () => {
    expect(parsePrice('seventy five dollars')).toBe(75);
    expect(parsePrice('forty five')).toBe(45);
    expect(parsePrice('twenty dollars')).toBe(20);
    expect(parsePrice('one hundred dollars')).toBe(100);
    expect(parsePrice('one hundred twenty dollars')).toBe(120);
  });

  it('parses retail slang ("one fifty" = 150)', () => {
    expect(parsePrice('one fifty')).toBe(150);
    expect(parsePrice('two fifty')).toBe(250);
    expect(parsePrice('three fifty')).toBe(350);
  });

  it('returns null for invalid input', () => {
    expect(parsePrice('')).toBeNull();
    expect(parsePrice('hello')).toBeNull();
  });
});

describe('parseSize', () => {
  const cases: [string, string | null][] = [
    ['small', 'S'],
    ['medium', 'M'],
    ['large', 'L'],
    ['extra large', 'XL'],
    ['extra small', 'XS'],
    ['XXL', 'XXL'],
    ['xxl', 'XXL'],
    ['double extra large', 'XXL'],
    ['one size', 'OS'],
    ['MEDIUM', 'M'],
    ['huge', null],
    ['', null],
  ];
  test.each(cases)('parseSize("%s") → %s', (input, expected) => {
    expect(parseSize(input)).toBe(expected);
  });
});

describe('parseDecade', () => {
  const cases: [string, string | null][] = [
    ['seventies', "70's"],
    ['eighties', "80's"],
    ['nineties', "90's"],
    ['two thousands', "2000's"],
    ['y2k', "2000's"],
    ['80s', "80's"],
    ['1990s', "90's"],
    ['early two thousands', "2000's"],
    ['yesterday', null],
    ['', null],
  ];
  test.each(cases)('parseDecade("%s") → %s', (input, expected) => {
    expect(parseDecade(input)).toBe(expected);
  });
});

// ── UNIT: parseTranscript ───────────────────────────────────────────────────

describe('parseTranscript — size detection', () => {
  const cases: [string, string][] = [
    ['small', 'S'],
    ['medium', 'M'],
    ['large', 'L'],
    ['extra large', 'XL'],
    ['extra small', 'XS'],
    ['XXL', 'XXL'],
    ['double extra large', 'XXL'],
    ['one size', 'OS'],
    ['size 8', '8'],
  ];
  test.each(cases)('"%s" → %s', (input, expected) => {
    expect(parseTranscript(input).size).toBe(expected);
  });
});

describe('parseTranscript — decade detection', () => {
  const cases: [string, string][] = [
    ['seventies', "70's"],
    ['eighties', "80's"],
    ['nineties', "90's"],
    ['two thousands', "2000's"],
    ['y2k', "2000's"],
    ['80s', "80's"],
    ['1990s', "90's"],
    ['early two thousands', "2000's"],
  ];
  test.each(cases)('"%s" → %s', (input, expected) => {
    expect(parseTranscript(input).decade).toBe(expected);
  });
});

describe('parseTranscript — price detection', () => {
  const cases: [string, number][] = [
    ['seventy five dollars', 75],
    ['twenty five dollars', 25],
    ['one hundred dollars', 100],
    ['fifty bucks', 50],
    ['$45', 45],
    ['$45.00', 45],
    ['45 dollars', 45],
    ['ten dollars', 10],
    ['one fifty', 150],
  ];
  test.each(cases)('"%s" → %s', (input, expected) => {
    expect(parseTranscript(input).price).toBe(expected);
  });
});

describe('parseTranscript — item name extraction', () => {
  it('extracts item after removing metadata', () => {
    const r = parseTranscript('medium nineties Nike windbreaker seventy five dollars');
    expect(r.item_name).toBeTruthy();
    expect(r.item_name?.toLowerCase()).toContain('nike');
    expect(r.item_name?.toLowerCase()).toContain('windbreaker');
  });

  it('pure item name with no metadata', () => {
    const r = parseTranscript('Nike hoodie');
    expect(r.item_name).toBeTruthy();
    expect(r.item_name?.toLowerCase()).toContain('nike');
    expect(r.size).toBeNull();
    expect(r.decade).toBeNull();
    expect(r.price).toBeNull();
  });

  it('single size word has null item_name', () => {
    const r = parseTranscript('small');
    expect(r.size).toBe('S');
    expect(r.item_name).toBeNull();
  });

  it('single decade word has null item_name', () => {
    const r = parseTranscript('nineties');
    expect(r.decade).toBe("90's");
    expect(r.item_name).toBeNull();
  });

  it('single price has null item_name', () => {
    const r = parseTranscript('twenty five dollars');
    expect(r.price).toBe(25);
    expect(r.item_name).toBeNull();
  });
});

// ── UNIT: mergeItems ────────────────────────────────────────────────────────

describe('mergeItems — field preservation', () => {
  it('THE BUG: Nike hoodie then small', () => {
    const step1 = mergeItems({ ...EMPTY_ITEM }, parseTranscript('Nike hoodie'));
    expect(step1.item_name).toBeTruthy();

    const step2 = mergeItems(step1, parseTranscript('small'));

    expect(step2.size).toBe('S');
    expect(step2.item_name).toBeTruthy();
    expect(step2.item_name?.toLowerCase()).toContain('nike');
  });

  it('item name preserved when saying decade', () => {
    const after = mergeItems(
      { ...EMPTY_ITEM, item_name: 'Levi jeans' },
      parseTranscript('nineties')
    );
    expect(after.decade).toBe("90's");
    expect(after.item_name).toBe('Levi jeans');
  });

  it('item name preserved when saying price', () => {
    const after = mergeItems(
      { ...EMPTY_ITEM, item_name: 'Carhartt jacket' },
      parseTranscript('forty five dollars')
    );
    expect(after.price).toBe(45);
    expect(after.item_name).toBe('Carhartt jacket');
  });

  it('null never overwrites existing value', () => {
    const existing: ParsedItem = {
      ...EMPTY_ITEM,
      size: 'L',
      decade: "90's",
      item_name: 'vintage tee',
      price: 20,
    };
    const result = mergeItems(existing, { ...EMPTY_ITEM });

    expect(result.size).toBe('L');
    expect(result.decade).toBe("90's");
    expect(result.item_name).toBe('vintage tee');
    expect(result.price).toBe(20);
  });

  it('incoming non-null value wins over existing', () => {
    const existing: ParsedItem = { ...EMPTY_ITEM, size: 'M', price: 20 };
    const incoming: ParsedItem = { ...EMPTY_ITEM, size: 'L', price: 30 };
    const result = mergeItems(existing, incoming);
    expect(result.size).toBe('L');
    expect(result.price).toBe(30);
  });

  it('incoming item_name replaces existing when more specific', () => {
    const result = mergeItems(
      { ...EMPTY_ITEM, item_name: 'hoodie' },
      { ...EMPTY_ITEM, item_name: 'Nike Zip Up Hoodie' }
    );
    // Longer wins
    expect(result.item_name).toBe('Nike Zip Up Hoodie');
  });
});

// ── INTEGRATION: real user flows ────────────────────────────────────────────

describe('buildItemFromTranscripts — real user flows', () => {
  it('FLOW 1: standard order', () => {
    const item = buildItemFromTranscripts(
      'medium',
      'nineties',
      'Polo Ralph Lauren shirt',
      'seventy five dollars'
    );
    expect(item.size).toBe('M');
    expect(item.decade).toBe("90's");
    expect(item.item_name?.toLowerCase()).toContain('polo');
    expect(item.price).toBe(75);
    expect(item.confidence).toBe(100);
  });

  it('FLOW 2: price first', () => {
    const item = buildItemFromTranscripts(
      'seventy five dollars',
      'Nike windbreaker',
      'large',
      'nineties'
    );
    expect(item.price).toBe(75);
    expect(item.item_name?.toLowerCase()).toContain('nike');
    expect(item.size).toBe('L');
    expect(item.decade).toBe("90's");
  });

  it('FLOW 3: item name first (THE REPORTED BUG)', () => {
    const item = buildItemFromTranscripts(
      'Nike hoodie',
      'small',
      'nineties',
      'twenty five dollars'
    );
    expect(item.item_name?.toLowerCase()).toContain('nike');
    expect(item.size).toBe('S');
    expect(item.decade).toBe("90's");
    expect(item.price).toBe(25);
  });

  it('FLOW 4: all in one sentence any order', () => {
    const item = buildItemFromTranscripts('twenty dollars large eighties Levi jeans');
    expect(item.price).toBe(20);
    expect(item.size).toBe('L');
    expect(item.decade).toBe("80's");
    expect(item.item_name?.toLowerCase()).toContain('levi');
  });

  it('FLOW 5: natural rambling speech', () => {
    const item = buildItemFromTranscripts(
      'um this is a really nice',
      'Carhartt Detroit jacket',
      'its a large',
      'from the nineties I think',
      'I would say ninety dollars'
    );
    expect(item.item_name?.toLowerCase()).toContain('carhartt');
    expect(item.size).toBe('L');
    expect(item.decade).toBe("90's");
    expect(item.price).toBe(90);
  });

  it('FLOW 6: correction — says wrong price then corrects', () => {
    const item = buildItemFromTranscripts(
      'Nike tee medium nineties',
      'forty dollars',
      'actually thirty dollars'
    );
    // Latest non-null price wins
    expect(item.price).toBe(30);
    expect(item.item_name?.toLowerCase()).toContain('nike');
    expect(item.size).toBe('M');
  });

  it('FLOW 7: partial entry — only name and price', () => {
    const item = buildItemFromTranscripts(
      'vintage leather jacket',
      'one hundred dollars'
    );
    expect(item.item_name?.toLowerCase()).toContain('leather');
    expect(item.price).toBe(100);
    expect(item.size).toBeNull();
    expect(item.decade).toBeNull();
  });

  it('FLOW 8: brand names with common words', () => {
    const item = buildItemFromTranscripts(
      'small',
      'Champion reverse weave sweatshirt',
      'eighties',
      'fifty dollars'
    );
    expect(item.size).toBe('S');
    expect(item.item_name?.toLowerCase()).toContain('champion');
    expect(item.decade).toBe("80's");
    expect(item.price).toBe(50);
  });

  it('FLOW 9: numeric size', () => {
    const item = buildItemFromTranscripts(
      'size 10',
      'nineties floral dress',
      'thirty five dollars'
    );
    expect(item.size).toBe('10');
    expect(item.item_name?.toLowerCase()).toContain('dress');
    expect(item.price).toBe(35);
  });

  it('FLOW 10: extra large not confused with large', () => {
    const item = buildItemFromTranscripts(
      'extra large nineties Starter jacket fifty dollars'
    );
    expect(item.size).toBe('XL');
    expect(item.size).not.toBe('L');
    expect(item.item_name?.toLowerCase()).toContain('starter');
  });
});

// ── EDGE CASES ──────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('empty transcript returns empty item', () => {
    const r = parseTranscript('');
    expect(r.size).toBeNull();
    expect(r.decade).toBeNull();
    expect(r.item_name).toBeNull();
    expect(r.price).toBeNull();
  });

  it('filler words only return empty item', () => {
    const r = parseTranscript('um uh like you know');
    expect(r.size).toBeNull();
    expect(r.decade).toBeNull();
    expect(r.price).toBeNull();
    expect(r.item_name).toBeNull();
    expect(r.confidence).toBe(0);
  });

  it('confidence 100 for full item', () => {
    const r = parseTranscript('medium nineties Nike hoodie fifty dollars');
    expect(r.confidence).toBe(100);
  });

  it('confidence 25 for single field', () => {
    expect(parseTranscript('small').confidence).toBe(25);
    expect(parseTranscript('nineties').confidence).toBe(25);
    expect(parseTranscript('fifty dollars').confidence).toBe(25);
  });
});
