import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Colors } from '../src/constants/theme';
import { useAutoPurge } from '../src/hooks/useAutoPurge';
import { useDeviceSecurityCheck } from '../src/hooks/useDeviceSecurityCheck';
import { initCrashReporting } from '../src/services/crashReporting';

export default function RootLayout() {
  useEffect(() => {
    initCrashReporting();
  }, []);
  useAutoPurge();
  useDeviceSecurityCheck();

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
