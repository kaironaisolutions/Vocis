import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  AUTO_PURGE_ENABLED: 'vocis_auto_purge_enabled',
  AUTO_PURGE_DAYS: 'vocis_auto_purge_days',
  LAST_PURGE_DATE: 'vocis_last_purge_date',
  EXPORT_PIN_ENABLED: 'vocis_export_pin_enabled',
} as const;

export interface AppSettings {
  autoPurgeEnabled: boolean;
  autoPurgeDays: number;
  exportPinEnabled: boolean;
}

const DEFAULTS: AppSettings = {
  autoPurgeEnabled: true,
  autoPurgeDays: 90,
  exportPinEnabled: false,
};

export const AppSettingsService = {
  async get(): Promise<AppSettings> {
    const [enabled, days, exportPin] = await Promise.all([
      AsyncStorage.getItem(KEYS.AUTO_PURGE_ENABLED),
      AsyncStorage.getItem(KEYS.AUTO_PURGE_DAYS),
      AsyncStorage.getItem(KEYS.EXPORT_PIN_ENABLED),
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

  async setExportPin(enabled: boolean): Promise<void> {
    await AsyncStorage.setItem(KEYS.EXPORT_PIN_ENABLED, String(enabled));
  },

  async getLastPurgeDate(): Promise<string | null> {
    return AsyncStorage.getItem(KEYS.LAST_PURGE_DATE);
  },

  async setLastPurgeDate(date: string): Promise<void> {
    await AsyncStorage.setItem(KEYS.LAST_PURGE_DATE, date);
  },
};
