import {
  parseTranscript,
  mergeItems,
  EMPTY_ITEM,
  parsePrice,
  parseSize,
  parseDecade,
  isValidTranscript,
  formatRawTitle,
  correctMishears,
  dedupeCommittedTranscript,
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

// ── REGRESSION: bare 2-digit numbers must not be parsed as decades ──────────
//
// "75 dollars" used to fail because the bare-2-digit decade regex had an
// optional 's' suffix and matched "75" as the decade "75's", leaving the
// price scanner with only "dollars" to work with.

describe('PRICE BUG — must all return correct price', () => {
  const cases: [string, number][] = [
    ['$25', 25],
    ['$75.00', 75],
    ['25 dollars', 25],
    ['75 dollars', 75],
    ['seventy five dollars', 75],
    ['twenty five dollars', 25],
    ['one hundred dollars', 100],
    ['fifty bucks', 50],
    ['forty five', 45],
    ['Nike hoodie twenty five dollars', 25],
    ['large nineties jacket seventy five dollars', 75],
  ];
  test.each(cases)('"%s" → price: %s', (input, expected) => {
    expect(parseTranscript(input).price).toBe(expected);
  });
});

describe('ITEM NAME BUG — extraction must preserve brand and garment words', () => {
  it('Nike hoodie extracted correctly', () => {
    const r = parseTranscript('Nike hoodie');
    expect(r.item_name?.toLowerCase()).toContain('nike');
    expect(r.item_name?.toLowerCase()).toContain('hoodie');
  });

  it('brand name not eaten by size removal', () => {
    const r = parseTranscript('small Nike hoodie');
    expect(r.size).toBe('S');
    expect(r.item_name?.toLowerCase()).toContain('nike');
  });

  it('brand name not eaten by price removal', () => {
    const r = parseTranscript('Nike hoodie twenty five dollars');
    expect(r.price).toBe(25);
    expect(r.item_name?.toLowerCase()).toContain('nike');
  });

  it('full item all fields', () => {
    const r = parseTranscript('medium nineties Nike hoodie twenty five dollars');
    expect(r.size).toBe('M');
    expect(r.decade).toBe("90's");
    expect(r.price).toBe(25);
    expect(r.item_name?.toLowerCase()).toContain('nike');
  });

  it('item name capitalized correctly', () => {
    const r = parseTranscript('polo ralph lauren shirt');
    expect(r.item_name).toBe('Polo Ralph Lauren Shirt');
  });

  it('trailing period stripped from item name', () => {
    const r = parseTranscript('Nike Hoodie. Twenty five dollars.');
    expect(r.item_name).toBe('Nike Hoodie');
    expect(r.price).toBe(25);
  });
});

// ── COLLISION: decade words ("nineties") must not bleed into price ──────────
//
// Risk: "nineties" contains "ninety" which is also a price number-word.
// Our parser claims decade tokens before price detection runs, so the
// consumed set guards against this. These tests pin that behaviour down.

describe('COLLISION: decade words must not match price', () => {
  it('nineties → decade only, price null', () => {
    const r = parseTranscript('nineties');
    expect(r.decade).toBe("90's");
    expect(r.price).toBeNull();
  });

  it('eighties → decade only, price null', () => {
    const r = parseTranscript('eighties');
    expect(r.decade).toBe("80's");
    expect(r.price).toBeNull();
  });

  it('seventies → decade only, price null', () => {
    const r = parseTranscript('seventies');
    expect(r.decade).toBe("70's");
    expect(r.price).toBeNull();
  });

  it('sixties → decade only, price null', () => {
    const r = parseTranscript('sixties');
    expect(r.decade).toBe("60's");
    expect(r.price).toBeNull();
  });

  it('nineties jacket → decade + item, no price', () => {
    const r = parseTranscript('nineties jacket');
    expect(r.decade).toBe("90's");
    expect(r.price).toBeNull();
    expect(r.item_name?.toLowerCase()).toContain('jacket');
  });

  it('ninety dollars → price only, no decade', () => {
    const r = parseTranscript('ninety dollars');
    expect(r.price).toBe(90);
    expect(r.decade).toBeNull();
  });

  it('nineties jacket ninety dollars → all separate', () => {
    const r = parseTranscript('nineties jacket ninety dollars');
    expect(r.decade).toBe("90's");
    expect(r.price).toBe(90);
    expect(r.item_name?.toLowerCase()).toContain('jacket');
  });

  it('eighties bomber eighty dollars → all separate', () => {
    const r = parseTranscript('eighties bomber eighty dollars');
    expect(r.decade).toBe("80's");
    expect(r.price).toBe(80);
    expect(r.item_name?.toLowerCase()).toContain('bomber');
  });
});

// ── isValidTranscript filter ────────────────────────────────────────────────

describe('isValidTranscript filter', () => {
  // Junk fragments — must not reach the parser.
  const FRAGMENTS = [
    "'9", "'19", "'90",
    '9', '5', '0',                // 1-digit
    '1930', '1990', '2000', '12345',  // 4+ digit (years/runaway)
    '60', '70', '80', '90',           // ambiguous decade-suffix bare numbers
    '00', '000', '0000',              // pure-zero fragments
    '-4', '-439',                     // negative numbers
    ',300', '1930.',
    'be', 'for', 'a', 'an', 'the', 'um', 'uh',
    '',
  ];
  test.each(FRAGMENTS)('filters fragment "%s"', (input) => {
    expect(isValidTranscript(input)).toBe(false);
  });

  // Inputs that must pass — including 2–3 digit bare numbers that
  // ElevenLabs sends when it drops the "dollars" word. 60/70/80/90 are
  // intentionally excluded above because they're more often partial
  // decade words than prices in real inventory.
  const VALID = [
    'Nike hoodie',
    'small',
    'nineties',
    "'90s",
    '$25',
    '$300',
    'twenty five dollars',
    'Nike hoodie 25',
    'medium nineties Nike hoodie twenty five dollars',
    '19', '25', '30', '45', '75', '150', '300', '999',
  ];
  test.each(VALID)('passes valid transcript "%s"', (input) => {
    expect(isValidTranscript(input)).toBe(true);
  });
});

// The user's bug: "thirty dollars" spoken, ElevenLabs commits "30".
// We want price=30. Tests pin this behaviour for every 2-3 digit number
// likely to come through as a stripped price.
describe('price: ElevenLabs bare-number formats', () => {
  const cases: [string, number][] = [
    ['$25', 25], ['$75', 75], ['$300', 300], ['$80', 80],
    ['25', 25], ['30', 30], ['45', 45], ['75', 75],
    ['80', 80], ['90', 90], ['100', 100], ['150', 150],
    ['300', 300],
  ];
  test.each(cases)('"%s" → price: %d', (input, expected) => {
    expect(parseTranscript(input).price).toBe(expected);
  });
});

describe('price: out-of-range values are rejected', () => {
  const rejected: string[] = [
    '$530', '$999', '$1000',  // explicit-dollar above $500 cap
    '999', '530',              // bare numbers above $500 cap
  ];
  test.each(rejected)('"%s" → price: null', (input) => {
    expect(parseTranscript(input).price).toBeNull();
  });
});

// 4-digit numbers must never become prices — they're years or runaway
// streaming fragments. Pattern C inside the parser also enforces this
// as defense-in-depth.
describe('price: years are never prices', () => {
  const years = ['1930', '1990', '2000', '1980'];
  test.each(years)('"%s" → price: null', (input) => {
    expect(parseTranscript(input).price).toBeNull();
  });
});

// ── REAL INVENTORY DATA — 4,503 items across 65 restock sheets ─────────────

function sim(...transcripts: string[]): ParsedItem {
  let item: ParsedItem = { ...EMPTY_ITEM };
  for (const t of transcripts) {
    if (isValidTranscript(t)) {
      item = mergeItems(item, parseTranscript(t));
    }
  }
  return item;
}

describe('Real inventory items - single transcript', () => {
  it('90s Polo Red Quilted Bomber 2XL $190', () => {
    const r = parseTranscript('90s Polo Red Quilted Bomber 2XL $190');
    expect(r.decade).toBe("90's");
    expect(r.price).toBe(190);
    expect(r.item_name?.toLowerCase()).toContain('polo');
  });

  it('80s Carhartt chore coat XL $180', () => {
    const r = parseTranscript('80s Carhartt chore coat XL $180');
    expect(r.decade).toBe("80's");
    expect(r.price).toBe(180);
    expect(r.item_name?.toLowerCase()).toContain('carhartt');
  });

  it('70s Levi bell bottom jeans $70', () => {
    const r = parseTranscript('70s Levi bell bottom jeans $70');
    expect(r.decade).toBe("70's");
    expect(r.price).toBe(70);
  });

  it('90s LL Bean windbreaker $80', () => {
    const r = parseTranscript('90s LL Bean windbreaker $80');
    expect(r.decade).toBe("90's");
    expect(r.price).toBe(80);
  });

  it('Polo leather harrington XL $320', () => {
    const r = parseTranscript('Polo leather harrington XL $320');
    expect(r.price).toBe(320);
    expect(r.item_name?.toLowerCase()).toContain('polo');
  });
});

describe('Real inventory items - separate recordings', () => {
  it('Carhartt jacket | large | 80s | $185', () => {
    const item = sim('Carhartt jacket', 'large', '80s', '$185');
    expect(item.item_name?.toLowerCase()).toContain('carhartt');
    expect(item.size).toBe('L');
    expect(item.decade).toBe("80's");
    expect(item.price).toBe(185);
  });

  it('$45 | small | 90s | LL Bean flannel', () => {
    const item = sim('$45', 'small', '90s', 'LL Bean flannel');
    expect(item.price).toBe(45);
    expect(item.size).toBe('S');
    expect(item.decade).toBe("90's");
  });

  it('Woolrich flannel | $80 | medium | 90s', () => {
    const item = sim('Woolrich flannel', '$80', 'medium', '90s');
    expect(item.price).toBe(80);
    expect(item.size).toBe('M');
    expect(item.decade).toBe("90's");
  });

  it('90s | Polo leather harrington | XL | $320', () => {
    const item = sim('90s', 'Polo leather harrington', 'XL', '$320');
    expect(item.price).toBe(320);
    expect(item.decade).toBe("90's");
    expect(item.item_name?.toLowerCase()).toContain('polo');
  });

  it('$50 | Dickies carpenter pants | 34x30', () => {
    const item = sim('$50', 'Dickies carpenter pants', '34x30');
    expect(item.price).toBe(50);
    expect(item.item_name?.toLowerCase()).toContain('dickies');
  });
});

describe('Price preservation across all field orders (Carhartt jacket)', () => {
  const orders: string[][] = [
    ['Carhartt jacket', 'large', '80s', '$185'],
    ['Carhartt jacket', 'large', '$185', '80s'],
    ['Carhartt jacket', '80s', 'large', '$185'],
    ['Carhartt jacket', '80s', '$185', 'large'],
    ['Carhartt jacket', '$185', 'large', '80s'],
    ['Carhartt jacket', '$185', '80s', 'large'],
    ['large', 'Carhartt jacket', '80s', '$185'],
    ['large', '80s', 'Carhartt jacket', '$185'],
    ['large', '$185', 'Carhartt jacket', '80s'],
    ['$185', 'Carhartt jacket', 'large', '80s'],
    ['$185', 'large', 'Carhartt jacket', '80s'],
    ['$185', '80s', 'large', 'Carhartt jacket'],
  ];
  test.each(orders)(
    'order: %s | %s | %s | %s',
    (a, b, c, d) => {
      const item = sim(a, b, c, d);
      expect(item.price).toBe(185);
      expect(item.size).toBe('L');
      expect(item.decade).toBe("80's");
      expect(item.item_name?.toLowerCase()).toContain('carhartt');
    }
  );
});

describe('Price detection — every real inventory price point', () => {
  const all: [string, number][] = [
    ['$35', 35], ['$40', 40], ['$45', 45],
    ['$50', 50], ['$55', 55], ['$60', 60],
    ['$65', 65], ['$70', 70], ['$75', 75],
    ['$80', 80], ['$85', 85], ['$90', 90],
    ['$95', 95], ['$100', 100], ['$110', 110],
    ['$125', 125], ['$135', 135], ['$140', 140],
    ['$150', 150], ['$160', 160], ['$175', 175],
    ['$180', 180], ['$185', 185], ['$190', 190],
    ['$200', 200], ['$250', 250], ['$265', 265],
    ['$320', 320],
  ];
  test.each(all)('%s → %d', (input, expected) => {
    expect(parseTranscript(input).price).toBe(expected);
  });
});

// Single-word filler / mishear fragments must NOT become item_name. Real
// items (Nike, Carhartt — already kept by being legit single-word brands
// that aren't in the invalid list) and multi-word names ("Call Sign Jacket")
// are unaffected.
describe('Single-word filler/mishear words must not become item_name', () => {
  const fillers = [
    'call', 'song', 'car', 'count', 'monkey', 'parts', 'good',
    'add', 'feel', 'video', 'videos', 'dream', 'plus',
    'dollars', 'dollar', 'bucks',
  ];
  test.each(fillers)('"%s" → item_name null', (input) => {
    const r = parseTranscript(input);
    expect(r.item_name).toBeNull();
  });

  it('Nike alone is still a valid item_name', () => {
    expect(parseTranscript('Nike').item_name).toBe('Nike');
  });

  it('multi-word phrase containing a filler word is preserved', () => {
    const r = parseTranscript('Call Sign Jacket');
    expect(r.item_name?.toLowerCase()).toContain('sign');
    expect(r.item_name?.toLowerCase()).toContain('jacket');
  });
});

// Bugs reproduced from live console logs (commit ea32dd5 → fa3b341 era).
// Each entry corresponds to a line we saw in real Scribe output that was
// producing wrong fields.
describe('Price preservation across repeated utterances', () => {
  it('price survives 5 subsequent commits including a duplicate size', () => {
    let item: ParsedItem = { ...EMPTY_ITEM };
    item = mergeItems(item, parseTranscript('$185'));
    expect(item.price).toBe(185);
    item = mergeItems(item, parseTranscript('small'));
    expect(item.price).toBe(185);
    item = mergeItems(item, parseTranscript("'80s"));
    expect(item.price).toBe(185);
    item = mergeItems(item, parseTranscript('Carhartt jacket'));
    expect(item.price).toBe(185);
    item = mergeItems(item, parseTranscript('small'));
    expect(item.price).toBe(185);
  });
});

describe('Live-log regressions: garbage words must not bleed into item_name', () => {
  it('"I feel a small Nike hat" → size S, item Nike Hat (no "Feel")', () => {
    const r = parseTranscript('I feel a small Nike hat');
    expect(r.size).toBe('S');
    expect(r.item_name?.toLowerCase()).toContain('nike');
    expect(r.item_name?.toLowerCase()).not.toContain('feel');
  });

  it('"large 90s Nike Hat videos" → no "Videos" in item_name', () => {
    const r = parseTranscript("large '90s Nike Hat videos");
    expect(r.size).toBe('L');
    expect(r.decade).toBe("90's");
    expect(r.item_name?.toLowerCase()).toContain('nike');
    expect(r.item_name?.toLowerCase()).not.toContain('video');
  });

  it('"Nike Hat babies" → no "Babies" in item_name', () => {
    const r = parseTranscript('Nike Hat babies');
    expect(r.item_name?.toLowerCase()).toContain('nike');
    expect(r.item_name?.toLowerCase()).not.toContain('babies');
  });

  it('"90 add" → price 90, no item name', () => {
    const r = parseTranscript('90 add');
    expect(r.price).toBe(90);
    expect(r.item_name).toBeNull();
  });

  it('"song 90s" → decade 90\'s, no item_name', () => {
    const r = parseTranscript('song 90s');
    expect(r.decade).toBe("90's");
    expect(r.item_name).toBeNull();
  });

  it('"with dollars" → filtered as junk (not a valid transcript)', () => {
    expect(isValidTranscript('with dollars')).toBe(false);
  });

  it('"i feel" → filtered as junk', () => {
    expect(isValidTranscript('i feel')).toBe(false);
  });

  it('standalone "dollars" / "with" / "add" → all filtered', () => {
    for (const noise of ['dollars', 'dollar', 'bucks', 'with', 'add', 'plus', 'feel']) {
      expect(isValidTranscript(noise)).toBe(false);
    }
  });
});

describe('Decade-suffix numbers must produce decade, never price', () => {
  const cases: [string, string][] = [
    ["'90s", "90's"], ['90s', "90's"],
    ["'80s", "80's"], ['80s', "80's"],
    ["'70s", "70's"], ['70s', "70's"],
    ["'60s", "60's"], ['60s', "60's"],
  ];
  test.each(cases)('"%s" → decade=%s, price null', (input, expectedDecade) => {
    const r = parseTranscript(input);
    expect(r.decade).toBe(expectedDecade);
    expect(r.price).toBeNull();
  });
});

describe('price: combined with other fields', () => {
  it("'90s $300 → decade and price", () => {
    const r = parseTranscript("'90s $300");
    expect(r.decade).toBe("90's");
    expect(r.price).toBe(300);
  });

  it('small Nike hat $80 → all fields', () => {
    const r = parseTranscript('small Nike hat $80');
    expect(r.size).toBe('S');
    expect(r.item_name?.toLowerCase()).toContain('nike');
    expect(r.price).toBe(80);
  });

  it('90s Nike hat 80 → decade + item + price', () => {
    const r = parseTranscript('90s Nike hat 80');
    expect(r.decade).toBe("90's");
    expect(r.item_name?.toLowerCase()).toContain('nike');
    expect(r.price).toBe(80);
  });
});

describe('ElevenLabs abbreviation formats', () => {
  const cases: [string, string][] = [
    ["'90s", "90's"],
    ["'80s", "80's"],
    ["'70s", "70's"],
    ['90s', "90's"],
    ['80s', "80's"],
    ['the 90s', "90's"],
    ['from the 90s', "90's"],
  ];
  test.each(cases)('"%s" → decade: %s', (input, expected) => {
    expect(parseTranscript(input).decade).toBe(expected);
  });
});

describe('ITEM NAME: extracted from any position', () => {
  it('item name first', () => {
    const r = parseTranscript('Carhartt jacket large eighties forty five dollars');
    expect(r.item_name?.toLowerCase()).toContain('carhartt');
    expect(r.size).toBe('L');
    expect(r.decade).toBe("80's");
    expect(r.price).toBe(45);
  });

  it('item name last', () => {
    const r = parseTranscript('large eighties forty five dollars Carhartt jacket');
    expect(r.item_name?.toLowerCase()).toContain('carhartt');
    expect(r.size).toBe('L');
    expect(r.decade).toBe("80's");
    expect(r.price).toBe(45);
  });

  it('item name middle', () => {
    const r = parseTranscript('large Carhartt jacket eighties forty five dollars');
    expect(r.item_name?.toLowerCase()).toContain('carhartt');
    expect(r.size).toBe('L');
    expect(r.decade).toBe("80's");
    expect(r.price).toBe(45);
  });
});

// ── DISPLAY / RAW_TITLE FORMATTING ─────────────────────────────────────────
//
// raw_title is built by formatRawTitle; behaviour pinned so the session
// list ("(L) Carhartt Jacket") doesn't regress to "(L) ? Carhartt Jacket"
// when a field is missing.

describe('formatRawTitle', () => {
  it('all fields present → full title', () => {
    expect(formatRawTitle('L', "90's", 'Carhartt Jacket')).toBe(
      "(L) 90's Carhartt Jacket"
    );
  });

  it('decade missing → decade segment omitted', () => {
    expect(formatRawTitle('L', null, 'Carhartt Jacket')).toBe(
      '(L) Carhartt Jacket'
    );
  });

  it('size missing → "(?)" kept, decade still shown', () => {
    expect(formatRawTitle(null, "90's", 'Hat')).toBe("(?) 90's Hat");
  });

  it('both size and decade missing → just name', () => {
    expect(formatRawTitle(null, null, 'Hat')).toBe('(?) Hat');
  });

  it('name missing → Unknown Item placeholder', () => {
    expect(formatRawTitle('L', "90's", null)).toBe("(L) 90's Unknown Item");
  });

  it('DB-style "?" placeholders treated like null', () => {
    // Items round-tripped through the DB store "?" for unknown size/decade;
    // formatRawTitle must format them the same as freshly-parsed items.
    expect(formatRawTitle('L', '?', 'Carhartt Jacket')).toBe('(L) Carhartt Jacket');
    expect(formatRawTitle('?', "90's", 'Hat')).toBe("(?) 90's Hat");
  });

  it('parseTranscript output uses cleaner format', () => {
    // "large Carhartt jacket" — size + name, no decade. The session list
    // used to render "(L) ? Carhartt Jacket"; should now be clean.
    const r = parseTranscript('large Carhartt jacket');
    expect(r.size).toBe('L');
    expect(r.decade).toBeNull();
    expect(r.raw_title).toBe('(L) Carhartt Jacket');
  });
});

// ── DECADE TOKENS LEAKING INTO ITEM_NAME ───────────────────────────────────
//
// When Scribe emits two decade-shaped tokens in one transcript ("nineties
// 90s hat"), only the first wins the decade slot. The remaining "90s" used
// to leak into item_name as "90s Hat". stripFillers now drops decade-shaped
// tokens unconditionally.

describe('decade-shaped tokens must not leak into item_name', () => {
  it('"nineties 90s hat" → decade 90\'s, item_name "Hat"', () => {
    const r = parseTranscript('nineties 90s hat');
    expect(r.decade).toBe("90's");
    expect(r.item_name).toBe('Hat');
    expect(r.item_name).not.toMatch(/90/);
  });

  it("\"'90s 90s hat\" → decade 90's, item_name \"Hat\"", () => {
    const r = parseTranscript("'90s 90s hat");
    expect(r.decade).toBe("90's");
    expect(r.item_name).toBe('Hat');
  });

  it('"eighties 80s Carhartt jacket" → no decade leak into name', () => {
    const r = parseTranscript('eighties 80s Carhartt jacket');
    expect(r.decade).toBe("80's");
    expect(r.item_name?.toLowerCase()).toContain('carhartt');
    expect(r.item_name).not.toMatch(/80/);
  });
});

// ── MISHEAR CORRECTIONS ─────────────────────────────────────────────────────
//
// Even with keyterms in the WebSocket session config, ElevenLabs occasionally
// returns mishears for the brands we care about. correctMishears() rewrites
// known mishears to the canonical brand BEFORE parsing.

describe('correctMishears', () => {
  it('rewrites Carhartt mishears', () => {
    expect(correctMishears('Large Nikes cardwear jacket')).toBe(
      'Large Nikes Carhartt jacket'
    );
    expect(correctMishears('a carhart shirt')).toBe('a Carhartt shirt');
    expect(correctMishears("It's a car heart coat")).toBe(
      "It's a Carhartt coat"
    );
    expect(correctMishears('sarver jacket')).toBe('Carhartt jacket');
  });

  it('rewrites Woolrich mishears', () => {
    expect(correctMishears('vintage wool rich flannel')).toBe(
      'vintage Woolrich flannel'
    );
    expect(correctMishears('woolwich shirt')).toBe('Woolrich shirt');
  });

  it('rewrites Wrangler "rangler" fragment without breaking "wrangler"', () => {
    expect(correctMishears('rangler jeans')).toBe('Wrangler jeans');
    // Canonical spelling must be left alone — no double-correction.
    expect(correctMishears('Wrangler jeans')).toBe('Wrangler jeans');
  });

  it('Polo only fires with garment context', () => {
    // Bare "hello" stays — it's a real word.
    expect(correctMishears('hello there')).toBe('hello there');
    // With garment context, becomes Polo.
    expect(correctMishears('hello shirt')).toBe('Polo shirt');
    expect(correctMishears('hello jacket')).toBe('Polo jacket');
  });

  it('integration: parseTranscript runs correction first', () => {
    const r = parseTranscript('large cardwear jacket forty dollars');
    expect(r.size).toBe('L');
    expect(r.price).toBe(40);
    expect(r.item_name?.toLowerCase()).toContain('carhartt');
  });
});

// ── COMMITTED-TRANSCRIPT DEDUP ──────────────────────────────────────────────
//
// Doubled transcripts ("X. X.") came from sending audio twice. The audio
// pipeline now sends only the leftover chunk in commit:true so the bug is
// fixed at the source, but the dedup helper stays as defense-in-depth.

describe('dedupeCommittedTranscript', () => {
  it('collapses exact two-sentence duplicate', () => {
    expect(
      dedupeCommittedTranscript(
        "Large Nike's cardwear jacket. Large Nike's cardwear jacket."
      )
    ).toBe("Large Nike's cardwear jacket");
  });

  it('collapses case-insensitive duplicate', () => {
    expect(
      dedupeCommittedTranscript('Carhartt jacket. CARHARTT JACKET.')
    ).toBe('Carhartt jacket');
  });

  it('collapses 3x repetition', () => {
    expect(
      dedupeCommittedTranscript('Hat. Hat. Hat.')
    ).toBe('Hat');
  });

  it('leaves legitimate multi-sentence transcripts untouched', () => {
    const input = 'Large Carhartt jacket. Small Nike hat.';
    expect(dedupeCommittedTranscript(input)).toBe(input);
  });

  it('leaves single-sentence transcripts untouched', () => {
    expect(dedupeCommittedTranscript('Large Carhartt jacket')).toBe(
      'Large Carhartt jacket'
    );
  });

  it('handles empty / whitespace-only input', () => {
    expect(dedupeCommittedTranscript('')).toBe('');
    expect(dedupeCommittedTranscript('   ')).toBe('');
  });
});

// ── YEARS MUST NOT BECOME PRICES / NAMES / LOST SIZE ───────────────────────
//
// "1992" is a year, never a price. Years arriving in comma-segmented input
// ("Large 90s, 1992.") used to:
//   - parse the year as price (parsePrice missing year guard)
//   - lose size (parseSegmented passed full segment to parseSize, which
//     only does exact-word match)
//   - leave "1992" in item_name in some flows
// parsePrice now rejects 1900-2099 unconditionally and bare > $500 without
// $ context; parseSegmented does a word-level size scan; stripFillers
// drops year-shaped tokens.

describe('years must not become prices', () => {
  it('"1992" alone — filtered as junk transcript', () => {
    // isValidTranscript drops 4-digit pure-numeric inputs, so this never
    // even reaches parseTranscript in production. Document the contract.
    expect(isValidTranscript('1992')).toBe(false);
  });

  it('parsePrice("1992") rejects year', () => {
    expect(parsePrice('1992')).toBeNull();
  });

  it('parsePrice("1930") rejects year', () => {
    expect(parsePrice('1930')).toBeNull();
  });

  it('parsePrice("1992.") rejects year with trailing punct', () => {
    expect(parsePrice('1992.')).toBeNull();
  });

  it('parsePrice("$1992") still rejected — year guard fires regardless of $', () => {
    // Even with explicit $, a value in 1900-2099 is almost certainly a year
    // mistakenly transcribed. The user can hand-edit the field afterward
    // for legitimate $1995-priced items; the false-positive cost of
    // accepting it as price is higher.
    expect(parsePrice('$1992')).toBeNull();
  });

  it('parsePrice("750") without $ rejected — > $500 bare-number cap', () => {
    expect(parsePrice('750')).toBeNull();
  });

  it('parsePrice("$750") allowed — explicit $', () => {
    expect(parsePrice('$750')).toBe(750);
  });
});

describe('"Large 90s, 1992." regression', () => {
  it('year 1992 is not a price', () => {
    const r = parseTranscript('Large 90s, 1992.');
    expect(r.price).toBeNull();
  });

  it('size still detected when year present', () => {
    const r = parseTranscript('Large 90s, 1992.');
    expect(r.size).toBe('L');
  });

  it('decade detected from "90s" not from year', () => {
    const r = parseTranscript('Large 90s, 1992.');
    expect(r.decade).toBe("90's");
  });

  it('1992 is not an item name', () => {
    const r = parseTranscript('Large 90s, 1992.');
    expect(r.item_name).toBeNull();
  });
});
