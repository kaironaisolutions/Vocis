import { useEffect } from 'react';
import { Alert } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Colors } from '../src/constants/theme';
import { useAutoPurge } from '../src/hooks/useAutoPurge';
import { DeviceSecurity } from '../src/services/deviceSecurity';
import { initCrashReporting } from '../src/services/crashReporting';
import { AppSettingsService } from '../src/services/appSettings';
import { SecurityProvider, useSecurity } from '../src/context/SecurityContext';

function AppLayout() {
  const { setIsCompromised } = useSecurity();

  useEffect(() => {
    initCrashReporting();
    checkSecurityAndOnboarding();
  }, []);

  useAutoPurge();

  async function checkSecurityAndOnboarding() {
    // Jailbreak / root detection — runs once on launch
    const compromised = DeviceSecurity.isDeviceCompromised();
    if (compromised) {
      setIsCompromised(true);
      Alert.alert('Security Warning', DeviceSecurity.getWarningMessage(), [{ text: 'I Understand' }]);
    }

    // First-launch onboarding — show biometric lock notice once
    const seen = await AppSettingsService.hasSeenOnboarding();
    if (!seen) {
      await AppSettingsService.markOnboardingSeen();
      Alert.alert(
        'Data Protected',
        'Your inventory is protected with biometric authentication before export. You can change this in Settings.',
        [{ text: 'Got it' }]
      );
    }
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text,
          headerTitleStyle: { fontWeight: '600' },
          contentStyle: { backgroundColor: Colors.background },
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen
          name="index"
          options={{ title: 'Vocis', headerTitleAlign: 'center' }}
        />
        <Stack.Screen
          name="record"
          options={{ title: 'Recording', presentation: 'modal' }}
        />
        <Stack.Screen
          name="session/[id]"
          options={{ title: 'Session Review' }}
        />
        <Stack.Screen
          name="export"
          options={{ title: 'Export CSV', presentation: 'modal' }}
        />
        <Stack.Screen
          name="settings"
          options={{ title: 'Settings' }}
        />
        <Stack.Screen
          name="legal/privacy"
          options={{ title: 'Privacy Policy' }}
        />
        <Stack.Screen
          name="legal/terms"
          options={{ title: 'Terms of Service' }}
        />
        <Stack.Screen
          name="legal/licenses"
          options={{ title: 'Open Source Licenses' }}
        />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <SecurityProvider>
      <AppLayout />
    </SecurityProvider>
  );
}
