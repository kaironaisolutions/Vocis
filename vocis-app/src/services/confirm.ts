import { Alert, Platform } from 'react-native';

/**
 * Cross-platform destructive confirmation.
 *
 * On native, uses Alert.alert with Cancel + destructive button.
 * On web, react-native-web's Alert.alert does not invoke button onPress
 * callbacks — it only displays the title via window.alert(). We fall back
 * to window.confirm so the destructive flow actually runs.
 */
export function confirmDestructive(
  title: string,
  message: string,
  destructiveLabel: string,
  onConfirm: () => void
): void {
  if (Platform.OS === 'web') {
    const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
      ? window.confirm(`${title}\n\n${message}`)
      : true;
    if (ok) onConfirm();
    return;
  }

  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: destructiveLabel, style: 'destructive', onPress: onConfirm },
  ]);
}
