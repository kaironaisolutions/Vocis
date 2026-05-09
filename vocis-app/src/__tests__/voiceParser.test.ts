import {
  parsePrice,
  parseSize,
  parseDecade,
  parseTranscription,
} from '../services/voiceParser';

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
