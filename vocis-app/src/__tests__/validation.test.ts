import { validateItem, sanitizeField } from '../services/validation';

describe('validateItem', () => {
  const validItem = {
    size: 'M',
    decade: "90's",
    item_name: 'Polo Red Quilted Bomber',
    price: 75.0,
  };

  it('passes valid items', () => {
    const result = validateItem(validItem);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('errors on empty size', () => {
    const result = validateItem({ ...validItem, size: '' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Size is required.');
  });

  it('warns on undetected size', () => {
    const result = validateItem({ ...validItem, size: '?' });
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('warns on non-standard size', () => {
    const result = validateItem({ ...validItem, size: 'XXXL' });
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('not a standard size'))).toBe(true);
  });

  it('errors on empty decade', () => {
    const result = validateItem({ ...validItem, decade: '' });
    expect(result.valid).toBe(false);
  });

  it('warns on undetected decade', () => {
    const result = validateItem({ ...validItem, decade: '?' });
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('errors on empty item name', () => {
    const result = validateItem({ ...validItem, item_name: '' });
    expect(result.valid).toBe(false);
  });

  it('warns on Unknown Item', () => {
    const result = validateItem({ ...validItem, item_name: 'Unknown Item' });
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('errors on item name exceeding 200 chars', () => {
    const result = validateItem({ ...validItem, item_name: 'A'.repeat(201) });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('too long'))).toBe(true);
  });

  it('errors on NaN price', () => {
    const result = validateItem({ ...validItem, price: NaN });
    expect(result.valid).toBe(false);
  });

  it('errors on negative price', () => {
    const result = validateItem({ ...validItem, price: -10 });
    expect(result.valid).toBe(false);
  });

  it('warns on zero price', () => {
    const result = validateItem({ ...validItem, price: 0 });
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('$0.00'))).toBe(true);
  });

  it('rejects price exceeding maximum', () => {
    const result = validateItem({ ...validItem, price: 200000 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('exceeds maximum'))).toBe(true);
  });
});

describe('sanitizeField', () => {
  it('trims whitespace', () => {
    expect(sanitizeField('  hello  ')).toBe('hello');
  });

  it('collapses multiple spaces', () => {
    expect(sanitizeField('hello    world')).toBe('hello world');
  });

  it('removes control characters', () => {
    expect(sanitizeField('hello\x00world')).toBe('helloworld');
    expect(sanitizeField('test\x08value')).toBe('testvalue');
  });

  it('preserves normal text', () => {
    expect(sanitizeField('Polo Red Quilted Bomber')).toBe('Polo Red Quilted Bomber');
  });

  it('handles empty strings', () => {
    expect(sanitizeField('')).toBe('');
  });
});
