import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Switch, Alert, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Typography, Spacing, BorderRadius } from '../src/constants/theme';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { SecureStorage } from '../src/services/secureStorage';
import { AppSettingsService, AppSettings } from '../src/services/appSettings';
import { deleteAllSessions, getSessions } from '../src/db/database';
import * as LocalAuthentication from 'expo-local-authentication';

export default function SettingsScreen() {
  const router = useRouter();
  const [settings, setSettings] = useState<AppSettings>({
    autoPurgeEnabled: true,
    autoPurgeDays: 90,
    exportPinEnabled: false,
  });
  const [hasApiKey, setHasApiKey] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [hasBiometrics, setHasBiometrics] = useState(false);

  useEffect(() => {
    loadState();
  }, []);

  async function loadState() {
    const [key, savedSettings, sessions, bioHardware] = await Promise.all([
      SecureStorage.getApiKey(),
      AppSettingsService.get(),
      getSessions(),
      LocalAuthentication.hasHardwareAsync(),
    ]);
    setHasApiKey(!!key);
    setSettings(savedSettings);
    setSessionCount(sessions.length);
    setHasBiometrics(bioHardware);
  }

  async function handleToggleAutoPurge(value: boolean) {
    const updated = { ...settings, autoPurgeEnabled: value };
    setSettings(updated);
    await AppSettingsService.setAutoPurge(value, settings.autoPurgeDays);
  }

  function handleChangePurgeDays() {
    const PURGE_OPTIONS = [30, 60, 90, 180, 365];
    Alert.alert(
      'Auto-Delete Sessions After',
      'Choose how long to keep session history',
      [
        ...PURGE_OPTIONS.map((days) => ({
          text: `${days} days${days === settings.autoPurgeDays ? ' (current)' : ''}`,
          onPress: async () => {
            const updated = { ...settings, autoPurgeDays: days };
            setSettings(updated);
            await AppSettingsService.setAutoPurgeDays(days);
          },
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ]
    );
  }

  async function handleSaveApiKey() {
    const trimmed = apiKeyInput.trim();
    if (!trimmed) {
      Alert.alert('Invalid Key', 'Please enter a valid API key.');
      return;
    }
    try {
      await SecureStorage.setApiKey(trimmed);
      setHasApiKey(true);
      setApiKeyInput('');
      setShowApiKeyInput(false);
      Alert.alert('Saved', 'API key stored securely in device keychain.');
    } catch (error) {
      Alert.alert('Invalid Key', error instanceof Error ? error.message : 'Failed to save API key.');
    }
  }

  async function handleToggleExportPin(value: boolean) {
    const updated = { ...settings, exportPinEnabled: value };
    setSettings(updated);
    await AppSettingsService.setExportPin(value);
  }

  async function handleRemoveApiKey() {
    Alert.alert(
      'Remove API Key',
      'This will remove the stored API key. You will need to re-enter it to use voice recording.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await SecureStorage.deleteApiKey();
            setHasApiKey(false);
          },
        },
      ]
    );
  }

  async function handleDeleteAll() {
    if (sessionCount === 0) {
      Alert.alert('No Data', 'There are no sessions to delete.');
      return;
    }

    Alert.alert(
      'Delete All Sessions',
      `This will permanently delete all ${sessionCount} sessions and their items. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All',
          style: 'destructive',
          onPress: async () => {
            await deleteAllSessions();
            setSessionCount(0);
            Alert.alert('Deleted', 'All sessions have been removed.');
          },
        },
      ]
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* API Configuration */}
      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>API Configuration</Text>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.label}>ElevenLabs API Key</Text>
            <Text style={styles.sublabel}>
              {hasApiKey ? 'Stored securely in device keychain' : 'No key configured'}
            </Text>
          </View>
          {hasApiKey ? (
            <View style={styles.keyActions}>
              <Button
                title="Change"
                onPress={() => setShowApiKeyInput(true)}
                variant="outline"
                size="small"
              />
              <Button
                title="Remove"
                onPress={handleRemoveApiKey}
                variant="danger"
                size="small"
              />
            </View>
          ) : (
            <Button
              title="Set Key"
              onPress={() => setShowApiKeyInput(true)}
              variant="primary"
              size="small"
            />
          )}
        </View>

        {showApiKeyInput && (
          <View style={styles.apiKeyInputArea}>
            <TextInput
              style={styles.apiKeyInput}
              placeholder="Paste your ElevenLabs API key"
              placeholderTextColor={Colors.textMuted}
              value={apiKeyInput}
              onChangeText={setApiKeyInput}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.apiKeyButtons}>
              <Button
                title="Cancel"
                onPress={() => {
                  setShowApiKeyInput(false);
                  setApiKeyInput('');
                }}
                variant="secondary"
                size="small"
              />
              <Button
                title="Save"
                onPress={handleSaveApiKey}
                variant="primary"
                size="small"
              />
            </View>
          </View>
        )}
      </Card>

      {/* Data Management */}
      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Data Management</Text>

        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.label}>Auto-purge old sessions</Text>
            <TouchableOpacity onPress={handleChangePurgeDays} disabled={!settings.autoPurgeEnabled}>
              <Text style={[styles.sublabel, settings.autoPurgeEnabled && styles.sublabelTappable]}>
                Delete after {settings.autoPurgeDays} days · Tap to change
              </Text>
            </TouchableOpacity>
          </View>
          <Switch
            value={settings.autoPurgeEnabled}
            onValueChange={handleToggleAutoPurge}
            trackColor={{ false: Colors.border, true: Colors.primaryDark }}
            thumbColor={settings.autoPurgeEnabled ? Colors.primary : Colors.textMuted}
          />
        </View>

        <View style={[styles.row, { marginTop: Spacing.md }]}>
          <View style={styles.rowText}>
            <Text style={styles.label}>Stored sessions</Text>
            <Text style={styles.sublabel}>{sessionCount} sessions on device</Text>
          </View>
        </View>
      </Card>

      {/* Security */}
      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Security</Text>

        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.label}>Require authentication to export</Text>
            <Text style={styles.sublabel}>
              {hasBiometrics
                ? 'Use Face ID, Touch ID, or device passcode'
                : 'Biometric hardware not detected'}
            </Text>
          </View>
          <Switch
            value={settings.exportPinEnabled}
            onValueChange={handleToggleExportPin}
            disabled={!hasBiometrics}
            trackColor={{ false: Colors.border, true: Colors.primaryDark }}
            thumbColor={settings.exportPinEnabled ? Colors.primary : Colors.textMuted}
          />
        </View>
      </Card>

      {/* Danger Zone */}
      <Card style={styles.section}>
        <Text style={[styles.sectionTitle, { color: Colors.error }]}>
          Danger Zone
        </Text>
        <Text style={[styles.sublabel, { marginBottom: Spacing.md }]}>
          This action is permanent and cannot be undone.
        </Text>
        <Button
          title="Delete All Sessions"
          onPress={handleDeleteAll}
          variant="danger"
          size="medium"
        />
      </Card>

      {/* Legal & About */}
      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Legal</Text>
        <TouchableOpacity
          style={styles.legalLink}
          onPress={() => router.push('/legal/privacy')}
        >
          <Text style={styles.label}>Privacy Policy</Text>
          <Text style={styles.arrow}>{'>'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.legalLink}
          onPress={() => router.push('/legal/terms')}
        >
          <Text style={styles.label}>Terms of Service</Text>
          <Text style={styles.arrow}>{'>'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.legalLink}
          onPress={() => router.push('/legal/licenses')}
        >
          <Text style={styles.label}>Open Source Licenses</Text>
          <Text style={styles.arrow}>{'>'}</Text>
        </TouchableOpacity>
      </Card>

      {/* About */}
      <View style={styles.about}>
        <Text style={styles.aboutText}>Vocis v1.0.0</Text>
        <Text style={styles.aboutSubtext}>Voice Inventory Logger</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  section: {
    marginBottom: Spacing.md,
  },
  sectionTitle: {
    ...Typography.heading3,
    marginBottom: Spacing.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowText: {
    flex: 1,
    marginRight: Spacing.md,
  },
  label: {
    ...Typography.body,
  },
  sublabel: {
    ...Typography.bodySmall,
    marginTop: 2,
  },
  sublabelTappable: {
    color: Colors.accent,
    textDecorationLine: 'underline',
  },
  keyActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  apiKeyInputArea: {
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  apiKeyInput: {
    backgroundColor: Colors.surfaceLight,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    color: Colors.text,
    fontSize: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  apiKeyButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  about: {
    alignItems: 'center',
    marginTop: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  aboutText: {
    ...Typography.bodySmall,
  },
  aboutSubtext: {
    ...Typography.label,
    marginTop: Spacing.xs,
  },
  legalLink: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  arrow: {
    color: Colors.textMuted,
    fontSize: 16,
  },
});
