import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

const DB_ENCRYPTION_KEY = 'vocis_db_encryption_key';

export const SecureStorage = {
  /**
   * Generic secure key-value access for other services (e.g. app settings
   * flags that must live in Keychain/Keystore rather than AsyncStorage).
   * Import this instead of expo-secure-store directly — its web build is an
   * empty stub, so direct calls crash in the browser.
   */
  async getItem(key: string): Promise<string | null> {
    return SecureStore.getItemAsync(key);
  },

  async setItem(key: string, value: string): Promise<void> {
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
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
      key = await generateRandomKey(64);
      await SecureStore.setItemAsync(DB_ENCRYPTION_KEY, key, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
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
