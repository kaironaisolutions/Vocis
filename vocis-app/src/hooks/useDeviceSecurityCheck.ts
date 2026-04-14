import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { DeviceSecurity } from '../services/deviceSecurity';

/**
 * Checks device integrity on app launch.
 * Warns the user if the device is jailbroken/rooted
 * and disables API-dependent features.
 */
export function useDeviceSecurityCheck() {
  const [isCompromised, setIsCompromised] = useState(false);

  useEffect(() => {
    const compromised = DeviceSecurity.isDeviceCompromised();
    setIsCompromised(compromised);

    if (compromised) {
      Alert.alert(
        'Security Warning',
        DeviceSecurity.getWarningMessage(),
        [{ text: 'I Understand' }]
      );
    }
  }, []);

  return { isCompromised };
}
