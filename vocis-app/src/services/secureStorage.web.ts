/**
 * Web secure storage: mirrors the SecureStorage API from secureStorage.ts,
 * backed by localStorage. expo-secure-store's web build is an empty stub
 * (every method undefined), so the native module cannot be used here.
 * localStorage is NOT encrypted — acceptable on web because the ElevenLabs
 * key lives in the Cloudflare Worker and the web DB is unencrypted anyway.
 */
import * as Crypto from 'expo-crypto';

const DB_ENCRYPTION_KEY = 'vocis_db_encryption_key';

function storage(): Storage | null {
  // Accessing localStorage can throw (SSR, cookies disabled, private mode).
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export const SecureStorage = {
  /**
   * Generic key-value access mirroring the native SecureStorage API.
   * Plain localStorage on web — no Keychain equivalent exists.
   */
  async getItem(key: string): Promise<string | null> {
    return storage()?.getItem(key) ?? null;
  },

  async setItem(key: string, value: string): Promise<void> {
    const store = storage();
    if (!store) throw new Error('Browser storage is unavailable.');
    store.setItem(key, value);
  },

  /**
   * Get or generate the database encryption key. Unused by the web DB
   * (no SQLCipher in the browser) but kept for API parity.
   */
  async getDbEncryptionKey(): Promise<string> {
    const store = storage();
    let key = store?.getItem(DB_ENCRYPTION_KEY) ?? null;

    if (!key) {
      key = await generateRandomKey(64);
      store?.setItem(DB_ENCRYPTION_KEY, key);
    }

    return key;
  },
};

/**
 * Generate a cryptographically secure random key via expo-crypto.
 * Uses expo-crypto.getRandomBytesAsync — works on iOS, Android, and web.
 */
async function generateRandomKey(length: number): Promise<string> {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const values = await Crypto.getRandomBytesAsync(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[values[i] % chars.length];
  }
  return result;
}
