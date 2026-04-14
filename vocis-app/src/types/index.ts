export interface InventoryItem {
  id: string;
  size: string;
  decade: string;
  item_name: string;
  price: number;
  raw_title: string;
  session_id: string;
  logged_at: string;
}

export interface Session {
  id: string;
  created_at: string;
  item_count: number;
  total_value: number;
}

export type ExportFormat = 'custom' | 'shopify' | 'ebay';

export type Size = 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL';

export const SIZE_MAP: Record<string, Size> = {
  'extra small': 'XS',
  'x small': 'XS',
  'xs': 'XS',
  'small': 'S',
  's': 'S',
  'medium': 'M',
  'm': 'M',
  'large': 'L',
  'l': 'L',
  'extra large': 'XL',
  'x large': 'XL',
  'xl': 'XL',
  'xx large': 'XXL',
  'xxl': 'XXL',
  'double xl': 'XXL',
  '2xl': 'XXL',
};

export const DECADE_MAP: Record<string, string> = {
  'fifties': "50's",
  '50s': "50's",
  'sixties': "60's",
  '60s': "60's",
  'seventies': "70's",
  '70s': "70's",
  'eighties': "80's",
  '80s': "80's",
  'nineties': "90's",
  '90s': "90's",
  'two thousands': "2000's",
  '2000s': "2000's",
  'twenty tens': "2010's",
  '2010s': "2010's",
};
