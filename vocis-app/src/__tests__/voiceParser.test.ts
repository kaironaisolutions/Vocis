import {
  parsePrice,
  parseSize,
  parseDecade,
  parseTranscription,
  mergeItems,
  ParsedItem,
} from '../services/voiceParser';

// Helper for building a synthetic ParsedItem in the existing API shape.
function makeItem(overrides: Partial<ParsedItem>): ParsedItem {
  return {
    size: '?',
    decade: '?',
    item_name: 'Unknown Item',
    price: 0,
    raw_title: '(?) ? Unknown Item',
    raw_transcript: '',
    confidence: {
      size: false,
      decade: false,
      price: false,
      item_name: false,
    },
    confidence_score: 0,
    ...overrides,
  };
}

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
    expect(parsePrice('fifty')).toBe(50);
  });

  it('parses hyphenated prices', () => {
    expect(parsePrice('seventy-five dollars')).toBe(75);
    expect(parsePrice('twenty-five')).toBe(25);
  });

  it('returns null for invalid input', () => {
    expect(parsePrice('')).toBeNull();
    expect(parsePrice('hello')).toBeNull();
    expect(parsePrice('no price here')).toBeNull();
  });
});

describe('parseSize', () => {
  it('parses standard sizes', () => {
    expect(parseSize('small')).toBe('S');
    expect(parseSize('medium')).toBe('M');
    expect(parseSize('large')).toBe('L');
    expect(parseSize('extra large')).toBe('XL');
    expect(parseSize('xx large')).toBe('XXL');
  });

  it('parses abbreviations', () => {
    expect(parseSize('S')).toBe('S');
    expect(parseSize('M')).toBe('M');
    expect(parseSize('L')).toBe('L');
    expect(parseSize('XL')).toBe('XL');
    expect(parseSize('XXL')).toBe('XXL');
    expect(parseSize('2XL')).toBe('XXL');
  });

  it('is case insensitive', () => {
    expect(parseSize('MEDIUM')).toBe('M');
    expect(parseSize('Small')).toBe('S');
    expect(parseSize('LARGE')).toBe('L');
  });

  it('returns null for unknown sizes', () => {
    expect(parseSize('huge')).toBeNull();
    expect(parseSize('tiny')).toBeNull();
    expect(parseSize('')).toBeNull();
  });
});

describe('parseDecade', () => {
  it('parses word-based decades', () => {
    expect(parseDecade('seventies')).toBe("70's");
    expect(parseDecade('eighties')).toBe("80's");
    expect(parseDecade('nineties')).toBe("90's");
    expect(parseDecade('two thousands')).toBe("2000's");
  });

  it('parses numeric decades', () => {
    expect(parseDecade('70s')).toBe("70's");
    expect(parseDecade('80s')).toBe("80's");
    expect(parseDecade('90s')).toBe("90's");
    expect(parseDecade('2000s')).toBe("2000's");
  });

  it('parses full year patterns', () => {
    expect(parseDecade('1990s')).toBe("90's");
    expect(parseDecade('1980s')).toBe("80's");
    expect(parseDecade('2000s')).toBe("2000's");
    expect(parseDecade('2010s')).toBe("2010's");
  });

  it('returns null for invalid decades', () => {
    expect(parseDecade('yesterday')).toBeNull();
    expect(parseDecade('')).toBeNull();
  });
});

describe('parseTranscription', () => {
  it('parses a standard comma-separated entry', () => {
    const result = parseTranscription(
      'Medium, nineties, Polo Red Quilted Bomber, seventy-five dollars'
    );
    expect(result.size).toBe('M');
    expect(result.decade).toBe("90's");
    expect(result.item_name).toBe('Polo Red Quilted Bomber');
    expect(result.price).toBe(75);
    expect(result.raw_title).toBe("(M) 90's Polo Red Quilted Bomber");
  });

  it('parses entry with numeric price', () => {
    const result = parseTranscription('Large, eighties, Champion Reverse Weave Hoodie, $120');
    expect(result.size).toBe('L');
    expect(result.decade).toBe("80's");
    expect(result.item_name).toBe('Champion Reverse Weave Hoodie');
    expect(result.price).toBe(120);
  });

  it('parses entry with abbreviations', () => {
    const result = parseTranscription('S, 2000s, Tommy Hilfiger Flag Tee, $45');
    expect(result.size).toBe('S');
    expect(result.decade).toBe("2000's");
    expect(result.item_name).toBe('Tommy Hilfiger Flag Tee');
    expect(result.price).toBe(45);
  });

  it('parses extra large sizes', () => {
    const result = parseTranscription('extra large, nineties, Nike Windbreaker, fifty dollars');
    expect(result.size).toBe('XL');
    expect(result.decade).toBe("90's");
    expect(result.price).toBe(50);
  });

  it('sets confidence flags correctly', () => {
    const result = parseTranscription(
      'Medium, nineties, Polo Bomber, seventy-five dollars'
    );
    expect(result.confidence.size).toBe(true);
    expect(result.confidence.decade).toBe(true);
    expect(result.confidence.price).toBe(true);
    expect(result.confidence.item_name).toBe(true);
  });

  it('handles missing fields gracefully', () => {
    const result = parseTranscription('some random text with no structure');
    expect(result.size).toBe('?');
    expect(result.decade).toBe('?');
    // Should still have some item name
    expect(result.item_name.length).toBeGreaterThan(0);
  });

  // Natural speech — no commas
  it('parses natural speech: "large 90s red Champion hoodie 74.00"', () => {
    const result = parseTranscription('large 90s red Champion hoodie 74.00');
    expect(result.size).toBe('L');
    expect(result.decade).toBe("90's");
    expect(result.item_name).toBe('Red Champion Hoodie');
    expect(result.price).toBe(74);
  });

  it('parses natural speech: "Medium nineties Polo Red Quilted Bomber seventy five dollars"', () => {
    const result = parseTranscription('Medium nineties Polo Red Quilted Bomber seventy five dollars');
    expect(result.size).toBe('M');
    expect(result.decade).toBe("90's");
    expect(result.price).toBe(75);
    expect(result.item_name).toContain('Polo');
  });

  it('parses natural speech: "small 2000s Tommy Hilfiger flag tee 45"', () => {
    const result = parseTranscription('small 2000s Tommy Hilfiger flag tee 45');
    expect(result.size).toBe('S');
    expect(result.decade).toBe("2000's");
    expect(result.price).toBe(45);
    expect(result.item_name).toContain('Tommy');
  });

  it('parses natural speech: "extra large eighties Nike windbreaker 120"', () => {
    const result = parseTranscription('extra large eighties Nike windbreaker 120');
    expect(result.size).toBe('XL');
    expect(result.decade).toBe("80's");
    expect(result.price).toBe(120);
    expect(result.item_name).toContain('Nike');
  });
});

describe('order-independent parsing', () => {
  it('standard order works', () => {
    const result = parseTranscription(
      'Medium nineties Polo Ralph Lauren shirt seventy five dollars'
    );
    expect(result.size).toBe('M');
    expect(result.decade).toBe("90's");
    expect(result.price).toBe(75);
    expect(result.item_name).toContain('Polo Ralph Lauren');
  });

  it('price first', () => {
    const result = parseTranscription(
      'seventy five dollars medium nineties Polo Ralph Lauren shirt'
    );
    expect(result.size).toBe('M');
    expect(result.decade).toBe("90's");
    expect(result.price).toBe(75);
    expect(result.item_name).toContain('Polo Ralph Lauren');
  });

  it('decade first', () => {
    const result = parseTranscription(
      'nineties large Nike windbreaker twenty dollars'
    );
    expect(result.decade).toBe("90's");
    expect(result.size).toBe('L');
    expect(result.price).toBe(20);
  });

  it('size last', () => {
    const result = parseTranscription(
      'nineties Levi jeans fifty dollars large'
    );
    expect(result.size).toBe('L');
    expect(result.decade).toBe("90's");
    expect(result.price).toBe(50);
  });

  it('only item name and price', () => {
    const result = parseTranscription(
      'vintage leather jacket one hundred dollars'
    );
    expect(result.price).toBe(100);
    expect(result.size).toBe('?');
    expect(result.decade).toBe('?');
    expect(result.item_name).toContain('Vintage Leather Jacket');
  });

  it('dollar sign price', () => {
    const result = parseTranscription('medium eighties band tee $25');
    expect(result.price).toBe(25);
    expect(result.size).toBe('M');
    expect(result.decade).toBe("80's");
  });

  it('numeric size with "size N" prefix', () => {
    const result = parseTranscription(
      'size 8 nineties floral dress forty dollars'
    );
    expect(result.size).toBe('8');
    expect(result.price).toBe(40);
    expect(result.decade).toBe("90's");
    expect(result.item_name).toContain('Floral Dress');
  });

  it('confidence_score is 100 for a fully detected item', () => {
    const full = parseTranscription(
      'medium nineties Polo shirt seventy five dollars'
    );
    expect(full.confidence_score).toBe(100);
  });

  it('confidence_score is below 50 when most fields are missing', () => {
    const partial = parseTranscription('vintage jacket');
    expect(partial.confidence_score).toBeLessThan(50);
  });
});

describe('mergeItems', () => {
  it('preserves item_name when new transcript has only size', () => {
    const existing = makeItem({
      item_name: 'Nike Hoodie',
      raw_transcript: 'Nike hoodie',
      confidence: { size: false, decade: false, price: false, item_name: true },
      confidence_score: 25,
    });
    const incoming = makeItem({
      size: 'S',
      raw_transcript: 'small',
      confidence: { size: true, decade: false, price: false, item_name: false },
      confidence_score: 25,
    });

    const result = mergeItems(existing, incoming);

    expect(result.size).toBe('S');
    expect(result.item_name).toBe('Nike Hoodie');
    expect(result.decade).toBe('?');
    expect(result.price).toBe(0);
    expect(result.confidence.size).toBe(true);
    expect(result.confidence.item_name).toBe(true);
  });

  it('preserves item_name when new transcript has only decade', () => {
    const existing = makeItem({
      size: 'S',
      item_name: 'Nike Hoodie',
      raw_transcript: 'small Nike hoodie',
      confidence: { size: true, decade: false, price: false, item_name: true },
      confidence_score: 50,
    });
    const incoming = makeItem({
      decade: "90's",
      raw_transcript: 'nineties',
      confidence: { size: false, decade: true, price: false, item_name: false },
      confidence_score: 25,
    });

    const result = mergeItems(existing, incoming);

    expect(result.size).toBe('S');
    expect(result.decade).toBe("90's");
    expect(result.item_name).toBe('Nike Hoodie');
  });

  it('preserves item_name when new transcript has only price', () => {
    const existing = makeItem({
      size: 'S',
      decade: "90's",
      item_name: 'Nike Hoodie',
      raw_transcript: 'small nineties Nike hoodie',
      confidence: { size: true, decade: true, price: false, item_name: true },
      confidence_score: 75,
    });
    const incoming = makeItem({
      price: 25,
      raw_transcript: 'twenty five dollars',
      confidence: { size: false, decade: false, price: true, item_name: false },
      confidence_score: 25,
    });

    const result = mergeItems(existing, incoming);

    expect(result.size).toBe('S');
    expect(result.decade).toBe("90's");
    expect(result.item_name).toBe('Nike Hoodie');
    expect(result.price).toBe(25);
    expect(result.confidence_score).toBe(100);
  });

  it('builds a complete item across 4 separate transcripts', () => {
    let item: ParsedItem = makeItem({});

    // 1. item name
    item = mergeItems(item, parseTranscription('Nike windbreaker'));
    expect(item.confidence.item_name).toBe(true);
    expect(item.item_name.toLowerCase()).toContain('nike');
    expect(item.confidence.size).toBe(false);

    // 2. size
    item = mergeItems(item, parseTranscription('large'));
    expect(item.size).toBe('L');
    expect(item.confidence.item_name).toBe(true);
    expect(item.item_name.toLowerCase()).toContain('nike');

    // 3. decade
    item = mergeItems(item, parseTranscription('nineties'));
    expect(item.decade).toBe("90's");
    expect(item.size).toBe('L');
    expect(item.item_name.toLowerCase()).toContain('nike');

    // 4. price
    item = mergeItems(item, parseTranscription('fifty dollars'));
    expect(item.price).toBe(50);
    expect(item.decade).toBe("90's");
    expect(item.size).toBe('L');
    expect(item.item_name.toLowerCase()).toContain('nike');
    expect(item.confidence_score).toBe(100);
  });

  it('incoming item_name replaces existing when present', () => {
    const existing = makeItem({
      size: 'M',
      item_name: 'Hoodie',
      raw_transcript: 'medium hoodie',
      confidence: { size: true, decade: false, price: false, item_name: true },
      confidence_score: 50,
    });
    const incoming = makeItem({
      item_name: 'Nike Zip Up Hoodie',
      raw_transcript: 'Nike zip up hoodie',
      confidence: { size: false, decade: false, price: false, item_name: true },
      confidence_score: 25,
    });

    const result = mergeItems(existing, incoming);

    expect(result.item_name).toBe('Nike Zip Up Hoodie');
    expect(result.size).toBe('M');
  });

  it('low-confidence incoming does not overwrite a fully populated item', () => {
    const existing = makeItem({
      size: 'XL',
      decade: "80's",
      item_name: 'Carhartt Jacket',
      price: 45,
      raw_transcript: 'XL eighties Carhartt jacket forty five dollars',
      confidence: { size: true, decade: true, price: true, item_name: true },
      confidence_score: 100,
    });
    const incoming = makeItem({
      raw_transcript: 'um',
      // All confidence flags false → nothing should change.
    });

    const result = mergeItems(existing, incoming);

    expect(result.size).toBe('XL');
    expect(result.decade).toBe("80's");
    expect(result.item_name).toBe('Carhartt Jacket');
    expect(result.price).toBe(45);
    expect(result.confidence_score).toBe(100);
  });
});
