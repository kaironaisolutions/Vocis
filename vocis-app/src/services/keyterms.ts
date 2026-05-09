import AsyncStorage from '@react-native-async-storage/async-storage';
import { VOCIS_KEYTERMS } from '../constants/keyterms';

const CUSTOM_KEYTERMS_KEY = 'vocis_custom_keyterms_v1';
const MAX_CUSTOM_KEYTERMS = 100;
const MAX_KEYTERM_LENGTH = 40;

// Re-export the canonical list from src/constants/keyterms.ts so this
// module can stay focused on the AsyncStorage-backed user-extension API.
export const DEFAULT_KEYTERMS = VOCIS_KEYTERMS;

function sanitizeKeyterm(raw: string): string | null {
  const trimmed = raw.trim().replace(/[\x00-\x1F\x7F]/g, '');
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_KEYTERM_LENGTH) return trimmed.slice(0, MAX_KEYTERM_LENGTH);
  return trimmed;
}

export const KeytermsService = {
  /** Read the user-defined custom keyterms (in addition to defaults). */
  async getCustom(): Promise<string[]> {
    try {
      const raw = await AsyncStorage.getItem(CUSTOM_KEYTERMS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((s) => sanitizeKeyterm(String(s)))
        .filter((s): s is string => s !== null);
    } catch {
      return [];
    }
  },

  async setCustom(terms: string[]): Promise<void> {
    const cleaned = terms
      .map((t) => sanitizeKeyterm(t))
      .filter((s): s is string => s !== null)
      .slice(0, MAX_CUSTOM_KEYTERMS);
    await AsyncStorage.setItem(CUSTOM_KEYTERMS_KEY, JSON.stringify(cleaned));
  },

  /** Default + custom, deduplicated case-insensitively. */
  async getAll(): Promise<string[]> {
    const custom = await this.getCustom();
    const seen = new Set<string>();
    const out: string[] = [];
    for (const term of [...DEFAULT_KEYTERMS, ...custom]) {
      const k = term.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(term);
    }
    return out;
  },

  MAX_CUSTOM_KEYTERMS,
  MAX_KEYTERM_LENGTH,
};
