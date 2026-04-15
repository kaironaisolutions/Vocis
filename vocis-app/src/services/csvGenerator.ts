import Papa from 'papaparse';
import { InventoryItem, ExportFormat } from '../types';

/**
 * Sanitize a string value to prevent CSV formula injection.
 *
 * Defense-in-depth approach:
 * 1. Strip null bytes and control characters (except tab/newline — PapaParse handles those).
 * 2. Prefix any cell starting with a formula trigger char (=, +, -, @, tab, CR) with a
 *    single-quote so spreadsheet apps treat it as text rather than a formula.
 *
 * PapaParse is called with `quotes: true` which double-quotes every field, providing
 * an additional layer. The prefix handles the remaining case where some apps (Excel
 * on Windows) interpret formulas even inside quoted cells.
 */
function sanitizeCSVValue(value: string): string {
  // Strip null bytes and ASCII control characters (0x00–0x1F except 0x09 tab and 0x0A LF)
  let sanitized = value.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g, '');

  // Prefix formula trigger characters at the start of the value
  if (/^[=+\-@\t\r|]/.test(sanitized)) {
    sanitized = `'${sanitized}`;
  }

  return sanitized;
}

/**
 * Sanitize all string values in a record for CSV export.
 */
function sanitizeRecord<T extends Record<string, string | number>>(
  record: T
): T {
  const sanitized = { ...record };
  for (const key of Object.keys(sanitized)) {
    const val = sanitized[key as keyof T];
    if (typeof val === 'string') {
      (sanitized as Record<string, unknown>)[key] = sanitizeCSVValue(val);
    }
  }
  return sanitized;
}

/**
 * Generate CSV content for inventory items in the specified format.
 * All generation runs client-side — no server required.
 */
export function generateCSV(
  items: InventoryItem[],
  format: ExportFormat
): string {
  switch (format) {
    case 'custom':
      return generateCustomCSV(items);
    case 'shopify':
      return generateShopifyCSV(items);
    case 'ebay':
      return generateEbayCSV(items);
  }
}

/**
 * Format A — Custom Excel / Google Sheets
 * Columns: Title, Variant Price
 * Title format: (SIZE) DECADE ITEM_NAME
 * Price format: $XX.00
 */
function generateCustomCSV(items: InventoryItem[]): string {
  const data = items.map((item) => sanitizeRecord({
    Title: item.raw_title,
    'Variant Price': `$${item.price.toFixed(2)}`,
  }));

  return Papa.unparse(data, {
    quotes: true,
    header: true,
  });
}

/**
 * Format B — Shopify Product Import
 * Columns: Title, Variant Price, Variant SKU, Tags
 * SKU: AUTO-generated
 * Tags: vintage, decade tag, first word of item name (brand hint)
 */
function generateShopifyCSV(items: InventoryItem[]): string {
  const data = items.map((item, index) => {
    const tags = buildShopifyTags(item);
    const sku = generateSKU(item, index);

    return sanitizeRecord({
      Title: item.raw_title,
      'Variant Price': item.price.toFixed(2),
      'Variant SKU': sku,
      Tags: tags,
    });
  });

  return Papa.unparse(data, {
    quotes: true,
    header: true,
  });
}

/**
 * Format C — eBay / Depop
 * Columns: Title, Price, Size, Condition
 * Title excludes the (SIZE) prefix since size has its own column
 * Condition: always "Pre-owned" for vintage items
 */
function generateEbayCSV(items: InventoryItem[]): string {
  const data = items.map((item) => sanitizeRecord({
    Title: `${item.decade} ${item.item_name}`,
    Price: item.price.toFixed(2),
    Size: item.size,
    Condition: 'Pre-owned',
  }));

  return Papa.unparse(data, {
    quotes: true,
    header: true,
  });
}

/**
 * Build Shopify tags from item fields.
 * Always includes "vintage", the decade (cleaned), and a lowercase brand hint.
 */
function buildShopifyTags(item: InventoryItem): string {
  const tags: string[] = ['vintage'];

  // Add decade tag: "90's" -> "90s"
  if (item.decade && item.decade !== '?') {
    const decadeTag = item.decade.replace("'s", 's').toLowerCase();
    tags.push(decadeTag);
  }

  // Add brand hint from first word of item name
  const firstWord = item.item_name.split(' ')[0];
  if (firstWord && firstWord.length > 1) {
    tags.push(firstWord.toLowerCase());
  }

  return tags.join(', ');
}

/**
 * Generate a deterministic SKU for Shopify.
 * Format: VOC-{SIZE}-{INDEX+1}
 */
function generateSKU(item: InventoryItem, index: number): string {
  const sizeCode = item.size !== '?' ? item.size : 'OS';
  return `VOC-${sizeCode}-${String(index + 1).padStart(4, '0')}`;
}

/**
 * Get the suggested filename for an export.
 */
export function getExportFilename(format: ExportFormat): string {
  const date = new Date().toISOString().split('T')[0];
  const formatLabel = {
    custom: 'inventory',
    shopify: 'shopify-import',
    ebay: 'ebay-depop',
  }[format];

  return `vocis-${formatLabel}-${date}.csv`;
}
