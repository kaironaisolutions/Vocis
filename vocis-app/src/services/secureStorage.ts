import * as SecureStore from 'expo-secure-store';

const API_KEY_STORAGE_KEY = 'vocis_elevenlabs_api_key';
const DB_ENCRYPTION_KEY = 'vocis_db_encryption_key';

// ElevenLabs API keys follow a known format
const API_KEY_PATTERN = /^[a-zA-Z0-9_-]{20,}$/;

export const SecureStorage = {
  /**
   * Store the ElevenLabs API key in iOS Keychain / Android Keystore.
   * Key is validated before storage. Never stored in source code or app bundle.
   */
  async setApiKey(apiKey: string): Promise<void> {
    const trimmed = apiKey.trim();

    if (!trimmed) {
      throw new Error('API key cannot be empty.');
    }

    if (!API_KEY_PATTERN.test(trimmed)) {
      throw new Error(
        'Invalid API key format. Key should contain only alphanumeric characters, hyphens, and underscores.'
      );
    }

    await SecureStore.setItemAsync(API_KEY_STORAGE_KEY, trimmed, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },

  async getApiKey(): Promise<string | null> {
    return SecureStore.getItemAsync(API_KEY_STORAGE_KEY);
  },

  async deleteApiKey(): Promise<void> {
    await SecureStore.deleteItemAsync(API_KEY_STORAGE_KEY);
  },

  /**
   * Mask an API key for safe display in UI or logs.
   * Shows only the last 4 characters.
   */
  maskApiKey(key: string): string {
    if (key.length <= 4) return '****';
    return `${'*'.repeat(key.length - 4)}${key.slice(-4)}`;
  },

  /**
   * Get or generate the database encryption key.
   * Stored in Keychain/Keystore, derived per-device.
   * The key persists across app updates but is bound to this device.
   */
  async getDbEncryptionKey(): Promise<string> {
    let key = await SecureStore.getItemAsync(DB_ENCRYPTION_KEY);

    if (!key) {
      // Generate a cryptographically random key
      key = generateRandomKey(64);
      await SecureStore.setItemAsync(DB_ENCRYPTION_KEY, key, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    }

    return key;
  },
};

/**
 * Generate a cryptographically secure random key.
 * Requires crypto.getRandomValues — throws if unavailable.
 * Never falls back to Math.random which is not cryptographically secure.
 */
function generateRandomKey(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const values = new Uint8Array(length);

  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new Error(
      'crypto.getRandomValues is not available. Cannot generate secure encryption key. ' +
      'This should not happen in a React Native environment.'
    );
  }

  globalThis.crypto.getRandomValues(values);

  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[values[i] % chars.length];
  }
  return result;
}
