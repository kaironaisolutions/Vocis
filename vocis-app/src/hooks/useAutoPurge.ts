import { useEffect } from 'react';
import { AppSettingsService } from '../services/appSettings';
import { purgeOldSessions } from '../db/database';

/**
 * Runs auto-purge on app launch if enabled.
 * Only purges once per day to avoid unnecessary DB operations.
 */
export function useAutoPurge() {
  useEffect(() => {
    runPurgeIfNeeded();
  }, []);
}

async function runPurgeIfNeeded() {
  try {
    const settings = await AppSettingsService.get();
    if (!settings.autoPurgeEnabled) return;

    const lastPurge = await AppSettingsService.getLastPurgeDate();
    const today = new Date().toISOString().split('T')[0];

    // Only purge once per day
    if (lastPurge === today) return;

    await purgeOldSessions(settings.autoPurgeDays);
    await AppSettingsService.setLastPurgeDate(today);
  } catch {
    // Silently fail — purge is best-effort
  }
}
