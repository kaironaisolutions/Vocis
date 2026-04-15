import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const KEYS = {
  AUTO_PURGE_ENABLED: 'vocis_auto_purge_enabled',
  AUTO_PURGE_DAYS: 'vocis_auto_purge_days',
  LAST_PURGE_DATE: 'vocis_last_purge_date',
  // Export PIN flag controls a security gate — stored in SecureStore (Keychain/Keystore),
  // not AsyncStorage, so it cannot be tampered with on a rooted/jailbroken device.
  EXPORT_PIN_ENABLED: 'vocis_export_pin_enabled',
  // Tracks whether the user has seen the first-launch onboarding alert.
  ONBOARDING_V1: 'vocis_onboarding_v1',
} as const;

export interface AppSettings {
  autoPurgeEnabled: boolean;
  autoPurgeDays: number;
  exportPinEnabled: boolean;
}

const DEFAULTS: AppSettings = {
  autoPurgeEnabled: true,
  autoPurgeDays: 90,
  // Default ON — export lock is a security feature, users can opt out in Settings.
  exportPinEnabled: true,
};

export const AppSettingsService = {
  async get(): Promise<AppSettings> {
    const [enabled, days, exportPin] = await Promise.all([
      AsyncStorage.getItem(KEYS.AUTO_PURGE_ENABLED),
      AsyncStorage.getItem(KEYS.AUTO_PURGE_DAYS),
      // Export PIN is in SecureStore — not AsyncStorage — to prevent tampering.
      SecureStore.getItemAsync(KEYS.EXPORT_PIN_ENABLED),
    ]);

    return {
      autoPurgeEnabled: enabled !== null ? enabled === 'true' : DEFAULTS.autoPurgeEnabled,
      autoPurgeDays: days !== null ? parseInt(days, 10) : DEFAULTS.autoPurgeDays,
      exportPinEnabled: exportPin !== null ? exportPin === 'true' : DEFAULTS.exportPinEnabled,
    };
  },

  async setAutoPurge(enabled: boolean, days?: number): Promise<void> {
    await AsyncStorage.setItem(KEYS.AUTO_PURGE_ENABLED, String(enabled));
    if (days !== undefined) {
      await AsyncStorage.setItem(KEYS.AUTO_PURGE_DAYS, String(days));
    }
  },

  async setAutoPurgeDays(days: number): Promise<void> {
    await AsyncStorage.setItem(KEYS.AUTO_PURGE_DAYS, String(days));
  },

  async hasSeenOnboarding(): Promise<boolean> {
    const val = await AsyncStorage.getItem(KEYS.ONBOARDING_V1);
    return val === 'true';
  },

  async markOnboardingSeen(): Promise<void> {
    await AsyncStorage.setItem(KEYS.ONBOARDING_V1, 'true');
  },

  async setExportPin(enabled: boolean): Promise<void> {
    await SecureStore.setItemAsync(KEYS.EXPORT_PIN_ENABLED, String(enabled), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },

  async getLastPurgeDate(): Promise<string | null> {
    return AsyncStorage.getItem(KEYS.LAST_PURGE_DATE);
  },

  async setLastPurgeDate(date: string): Promise<void> {
    await AsyncStorage.setItem(KEYS.LAST_PURGE_DATE, date);
  },
};
