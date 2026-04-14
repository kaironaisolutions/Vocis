import * as LocalAuthentication from 'expo-local-authentication';
import { Alert } from 'react-native';
import { AppSettingsService } from './appSettings';

/**
 * Export security: optional biometric/PIN authentication before export,
 * and warnings for unencrypted delivery channels.
 */
export const ExportSecurity = {
  /**
   * Authenticate the user before allowing CSV export.
   * Uses device biometrics (Face ID, Touch ID, fingerprint) or device PIN.
   * Returns true if authenticated or if auth is not available/enabled.
   */
  async authenticate(): Promise<boolean> {
    const settings = await AppSettingsService.get();
    if (!settings.exportPinEnabled) return true;

    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) return true;

    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    if (!isEnrolled) return true;

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Authenticate to export inventory data',
      fallbackLabel: 'Use device passcode',
      disableDeviceFallback: false,
    });

    return result.success;
  },

  /**
   * Warn user when sharing via potentially unencrypted channels.
   * Returns a promise that resolves to true if user wants to proceed.
   */
  warnUnencryptedChannel(method: string): Promise<boolean> {
    if (method === 'download') return Promise.resolve(true);

    return new Promise((resolve) => {
      Alert.alert(
        'Security Notice',
        method === 'email'
          ? 'Email is typically unencrypted. Your inventory and pricing data will be visible to anyone who intercepts the message. Consider using a secure file sharing service instead.'
          : 'Shared files may be accessible to other apps. Ensure you are sharing to a trusted destination.',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Share Anyway', onPress: () => resolve(true) },
        ]
      );
    });
  },
};
