import { Platform } from 'react-native';
import { File } from 'expo-file-system';

/**
 * Basic jailbreak/root detection.
 * Checks for indicators that the device's security model has been compromised.
 *
 * This is not foolproof — a sophisticated attacker can bypass these checks.
 * The purpose is to warn legitimate users that their device's security
 * protections (Keychain, Keystore) may be weakened.
 *
 * For production, consider a dedicated library like:
 * - iOS: DTTJailbreakDetection or IOSSecuritySuite
 * - Android: RootBeer or SafetyNet/Play Integrity API
 */
export const DeviceSecurity = {
  /**
   * Check if the device appears to be jailbroken (iOS) or rooted (Android).
   */
  isDeviceCompromised(): boolean {
    if (Platform.OS === 'ios') {
      return checkiOSJailbreak();
    } else if (Platform.OS === 'android') {
      return checkAndroidRoot();
    }
    return false;
  },

  /**
   * Get a user-friendly warning message for compromised devices.
   */
  getWarningMessage(): string {
    const deviceType = Platform.OS === 'ios' ? 'jailbroken' : 'rooted';
    return (
      `This device appears to be ${deviceType}. ` +
      `Security protections like Keychain/Keystore may be weakened, ` +
      `potentially exposing your API key and inventory data. ` +
      `Voice recording features have been disabled for your protection. ` +
      `You can still view and export existing sessions.`
    );
  },
};

/**
 * iOS jailbreak indicators:
 * - Cydia app present
 * - Common jailbreak file paths exist
 * - Can write outside sandbox
 */
function checkiOSJailbreak(): boolean {
  const suspiciousPaths = [
    '/Applications/Cydia.app',
    '/Library/MobileSubstrate/MobileSubstrate.dylib',
    '/bin/bash',
    '/usr/sbin/sshd',
    '/etc/apt',
    '/private/var/lib/apt/',
    '/usr/bin/ssh',
  ];

  for (const path of suspiciousPaths) {
    try {
      const file = new File(path);
      if (file.exists) return true;
    } catch {
      // Cannot check — likely sandboxed (good)
    }
  }

  return false;
}

/**
 * Android root indicators:
 * - su binary present
 * - Common root management apps
 * - System properties indicating root
 */
function checkAndroidRoot(): boolean {
  const suspiciousPaths = [
    '/system/app/Superuser.apk',
    '/system/xbin/su',
    '/system/bin/su',
    '/sbin/su',
    '/data/local/xbin/su',
    '/data/local/bin/su',
    '/data/local/su',
    '/system/bin/failsafe/su',
  ];

  for (const path of suspiciousPaths) {
    try {
      const file = new File(path);
      if (file.exists) return true;
    } catch {
      // Cannot check — expected on non-rooted devices
    }
  }

  return false;
}
