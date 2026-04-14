import { SIZE_MAP } from '../types';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const VALID_SIZES = new Set(Object.values(SIZE_MAP));
// Also accept '?' for unresolved fields that user will manually correct
VALID_SIZES.add('?' as never);

const VALID_DECADE_PATTERN = /^(\d{2,4})'s$|^\?$/;

/**
 * Validate all parsed inventory item fields before writing to the database.
 * Returns errors (block save) and warnings (allow save with user confirmation).
 */
export function validateItem(fields: {
  size: string;
  decade: string;
  item_name: string;
  price: number;
}): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Size validation: must match known enum or '?'
  if (!fields.size || fields.size.trim() === '') {
    errors.push('Size is required.');
  } else if (fields.size === '?') {
    warnings.push('Size could not be detected. Please verify.');
  } else if (!VALID_SIZES.has(fields.size as never)) {
    warnings.push(`"${fields.size}" is not a standard size (XS, S, M, L, XL, XXL).`);
  }

  // Decade validation
  if (!fields.decade || fields.decade.trim() === '') {
    errors.push('Decade is required.');
  } else if (fields.decade === '?') {
    warnings.push('Decade could not be detected. Please verify.');
  } else if (!VALID_DECADE_PATTERN.test(fields.decade)) {
    warnings.push(`"${fields.decade}" is not a recognized decade format.`);
  }

  // Item name validation
  if (!fields.item_name || fields.item_name.trim() === '') {
    errors.push('Item name is required.');
  } else if (fields.item_name === 'Unknown Item') {
    warnings.push('Item name could not be detected. Please verify.');
  } else if (fields.item_name.length < 2) {
    warnings.push('Item name seems too short. Please verify.');
  } else if (fields.item_name.length > 200) {
    errors.push('Item name is too long (max 200 characters).');
  }

  // Price validation: must be a positive number, not NaN
  if (fields.price === undefined || fields.price === null || isNaN(fields.price)) {
    errors.push('Price must be a valid number.');
  } else if (fields.price < 0) {
    errors.push('Price cannot be negative.');
  } else if (fields.price === 0) {
    warnings.push('Price is $0.00. Please verify.');
  } else if (fields.price > 100000) {
    warnings.push(`Price $${fields.price.toFixed(2)} seems unusually high. Please verify.`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Sanitize a string field to prevent injection or corruption.
 * Strips control characters and excessive whitespace.
 */
export function sanitizeField(value: string): string {
  return value
    // Remove control characters (except newline/tab)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();
}
