import { generateCSV, getExportFilename } from '../services/csvGenerator';
import { InventoryItem } from '../types';

const SAMPLE_ITEMS: InventoryItem[] = [
  {
    id: 'item-1',
    size: 'M',
    decade: "90's",
    item_name: 'Polo Red Quilted Bomber',
    price: 75.0,
    raw_title: "(M) 90's Polo Red Quilted Bomber",
    session_id: 'session-1',
    logged_at: '2026-04-13T14:32:00Z',
  },
  {
    id: 'item-2',
    size: 'L',
    decade: "80's",
    item_name: 'Champion Reverse Weave Hoodie',
    price: 120.0,
    raw_title: "(L) 80's Champion Reverse Weave Hoodie",
    session_id: 'session-1',
    logged_at: '2026-04-13T14:33:00Z',
  },
  {
    id: 'item-3',
    size: 'S',
    decade: "2000's",
    item_name: 'Tommy Hilfiger Flag Tee',
    price: 45.0,
    raw_title: "(S) 2000's Tommy Hilfiger Flag Tee",
    session_id: 'session-1',
    logged_at: '2026-04-13T14:34:00Z',
  },
];

describe('generateCSV - Custom Excel format', () => {
  it('generates correct headers', () => {
    const csv = generateCSV(SAMPLE_ITEMS, 'custom');
    const lines = csv.split('\n');
    expect(lines[0].trim()).toBe('"Title","Variant Price"');
  });

  it('formats titles with (SIZE) prefix', () => {
    const csv = generateCSV(SAMPLE_ITEMS, 'custom');
    expect(csv).toContain("(M) 90's Polo Red Quilted Bomber");
    expect(csv).toContain("(L) 80's Champion Reverse Weave Hoodie");
  });

  it('formats prices with dollar sign', () => {
    const csv = generateCSV(SAMPLE_ITEMS, 'custom');
    expect(csv).toContain('$75.00');
    expect(csv).toContain('$120.00');
    expect(csv).toContain('$45.00');
  });

  it('generates correct number of rows', () => {
    const csv = generateCSV(SAMPLE_ITEMS, 'custom');
    const lines = csv.split('\n').filter((l) => l.trim());
    expect(lines.length).toBe(4); // header + 3 items
  });
});

describe('generateCSV - Shopify format', () => {
  it('generates correct headers', () => {
    const csv = generateCSV(SAMPLE_ITEMS, 'shopify');
    const lines = csv.split('\n');
    expect(lines[0].trim()).toBe('"Title","Variant Price","Variant SKU","Tags"');
  });

  it('includes SKUs with VOC prefix', () => {
    const csv = generateCSV(SAMPLE_ITEMS, 'shopify');
    expect(csv).toContain('VOC-M-0001');
    expect(csv).toContain('VOC-L-0002');
    expect(csv).toContain('VOC-S-0003');
  });

  it('includes vintage tag', () => {
    const csv = generateCSV(SAMPLE_ITEMS, 'shopify');
    expect(csv).toContain('vintage');
  });

  it('includes decade tags', () => {
    const csv = generateCSV(SAMPLE_ITEMS, 'shopify');
    expect(csv).toContain('90s');
    expect(csv).toContain('80s');
    expect(csv).toContain('2000s');
  });

  it('does not include dollar sign in price', () => {
    const csv = generateCSV(SAMPLE_ITEMS, 'shopify');
    // Shopify format uses plain number: 75.00, not $75.00
    const lines = csv.split('\n');
    // Check a data row (not header)
    const dataLine = lines[1];
    expect(dataLine).toContain('"75.00"');
  });
});

describe('generateCSV - eBay/Depop format', () => {
  it('generates correct headers', () => {
    const csv = generateCSV(SAMPLE_ITEMS, 'ebay');
    const lines = csv.split('\n');
    expect(lines[0].trim()).toBe('"Title","Price","Size","Condition"');
  });

  it('excludes size prefix from title', () => {
    const csv = generateCSV(SAMPLE_ITEMS, 'ebay');
    // eBay title should be "90's Polo Red Quilted Bomber", not "(M) 90's..."
    expect(csv).toContain("90's Polo Red Quilted Bomber");
    expect(csv).not.toContain('(M)');
  });

  it('includes size as separate column', () => {
    const csv = generateCSV(SAMPLE_ITEMS, 'ebay');
    expect(csv).toContain('"M"');
    expect(csv).toContain('"L"');
    expect(csv).toContain('"S"');
  });

  it('sets condition to Pre-owned', () => {
    const csv = generateCSV(SAMPLE_ITEMS, 'ebay');
    expect(csv).toContain('"Pre-owned"');
  });
});

describe('getExportFilename', () => {
  it('includes format name in filename', () => {
    expect(getExportFilename('custom')).toContain('inventory');
    expect(getExportFilename('shopify')).toContain('shopify-import');
    expect(getExportFilename('ebay')).toContain('ebay-depop');
  });

  it('includes date in filename', () => {
    const date = new Date().toISOString().split('T')[0];
    expect(getExportFilename('custom')).toContain(date);
  });

  it('has .csv extension', () => {
    expect(getExportFilename('custom')).toMatch(/\.csv$/);
  });
});

describe('CSV injection prevention', () => {
  const maliciousItems: InventoryItem[] = [
    {
      id: 'item-evil',
      size: 'M',
      decade: "90's",
      item_name: '=CMD|"/C calc"!A1',
      price: 50.0,
      raw_title: "(M) 90's =CMD|\"/C calc\"!A1",
      session_id: 'session-1',
      logged_at: '2026-04-13T14:32:00Z',
    },
    {
      id: 'item-evil2',
      size: 'L',
      decade: "80's",
      item_name: '+SUM(A1:A10)',
      price: 75.0,
      raw_title: "(L) 80's +SUM(A1:A10)",
      session_id: 'session-1',
      logged_at: '2026-04-13T14:33:00Z',
    },
  ];

  it('sanitizes formula-like values in custom format', () => {
    const csv = generateCSV(maliciousItems, 'custom');
    // The =CMD in raw_title after space should be sanitized
    expect(csv).toContain("'=CMD");
    // +SUM at start of raw_title content should be sanitized
    expect(csv).toContain("'+SUM");
  });

  it('sanitizes formula-like values in shopify format', () => {
    const csv = generateCSV(maliciousItems, 'shopify');
    expect(csv).toContain("'=CMD");
    expect(csv).toContain("'+SUM");
  });

  it('sanitizes formula-like values in ebay format', () => {
    const csv = generateCSV(maliciousItems, 'ebay');
    // eBay title is "90's =CMD..." — =CMD after space gets sanitized
    expect(csv).toContain("'=CMD");
    // "+SUM" at start of item_name
    expect(csv).toContain("'+SUM");
  });
});
