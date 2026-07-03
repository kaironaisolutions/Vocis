import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Switch, Alert, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Typography, Spacing, BorderRadius } from '../src/constants/theme';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { AppSettingsService, AppSettings } from '../src/services/appSettings';
import { deleteAllSessions, getSessions } from '../src/db/database';
import { confirmDestructive } from '../src/services/confirm';
import {
  addBrand,
  removeBrand,
  getCustomBrands,
  MAX_CUSTOM_BRANDS,
  MAX_BRAND_LENGTH,
} from '../src/services/customBrands';
import * as LocalAuthentication from 'expo-local-authentication';

export default function SettingsScreen() {
  const router = useRouter();
  const [settings, setSettings] = useState<AppSettings>({
    autoPurgeEnabled: true,
    autoPurgeDays: 90,
    exportPinEnabled: false,
  });
  const [sessionCount, setSessionCount] = useState(0);
  const [hasBiometrics, setHasBiometrics] = useState(false);
  const [customBrands, setCustomBrands] = useState<string[]>([]);
  const [brandDraft, setBrandDraft] = useState('');

  useEffect(() => {
    loadState();
  }, []);

  async function loadState() {
    const [savedSettings, sessions, bioHardware, brands] = await Promise.all([
      AppSettingsService.get(),
      getSessions(),
      LocalAuthentication.hasHardwareAsync(),
      getCustomBrands(),
    ]);
    setSettings(savedSettings);
    setSessionCount(sessions.length);
    setHasBiometrics(bioHardware);
    setCustomBrands(brands);
  }

  async function handleAddBrand() {
    const trimmed = brandDraft.trim();
    if (!trimmed) return;
    if (
      customBrands.length >= MAX_CUSTOM_BRANDS &&
      !customBrands.some((b) => b.toLowerCase() === trimmed.toLowerCase())
    ) {
      Alert.alert(
        'Limit reached',
        `Up to ${MAX_CUSTOM_BRANDS} custom brands. Remove one to add another.`
      );
      return;
    }
    const next = await addBrand(trimmed);
    setCustomBrands(next);
    setBrandDraft('');
  }

  async function handleRemoveBrand(brand: string) {
    const next = await removeBrand(brand);
    setCustomBrands(next);
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

  async function handleToggleExportPin(value: boolean) {
    const updated = { ...settings, exportPinEnabled: value };
    setSettings(updated);
    await AppSettingsService.setExportPin(value);
  }

  async function handleDeleteAll() {
    if (sessionCount === 0) {
      Alert.alert('No Data', 'There are no sessions to delete.');
      return;
    }

    confirmDestructive(
      'Delete All Sessions',
      `This will permanently delete all ${sessionCount} sessions and their items. This cannot be undone.`,
      'Delete All',
      async () => {
        try {
          await deleteAllSessions();
          setSessionCount(0);
          Alert.alert('Deleted', 'All sessions have been removed.');
        } catch (e) {
          console.error('[Delete] Delete-all-sessions failed:', e);
          Alert.alert('Delete Failed', 'Could not delete sessions. Please try again.');
        }
      }
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* Custom Brands — user-taught vocabulary injected as STT keyterms
          on the next recording. Learned automatically from item-name
          corrections on the review screen, or added manually here. */}
      <Card style={styles.section}>
        <View style={styles.row}>
          <Text style={styles.sectionTitle}>Custom Brands</Text>
          <Text style={styles.brandCount}>
            {customBrands.length} / {MAX_CUSTOM_BRANDS} custom brands
          </Text>
        </View>
        <Text style={[styles.sublabel, { marginBottom: Spacing.md }]}>
          Brands you sell that Vocis mishears. These are sent to the speech
          recognizer on every recording, alongside the built-in vintage list.
        </Text>

        <View style={styles.brandInputRow}>
          <TextInput
            style={styles.brandInput}
            value={brandDraft}
            onChangeText={setBrandDraft}
            placeholder="+ Add Brand (e.g. Stüssy)"
            placeholderTextColor={Colors.textMuted}
            autoCorrect={false}
            autoCapitalize="words"
            maxLength={MAX_BRAND_LENGTH}
            returnKeyType="done"
            onSubmitEditing={handleAddBrand}
          />
          <Button title="Add" onPress={handleAddBrand} variant="primary" size="small" />
        </View>

        {customBrands.length === 0 ? (
          <Text style={styles.sublabel}>
            No custom brands yet. Vocis learns automatically when you correct
            an item name on the session review screen — or add brands above to
            pre-load them.
          </Text>
        ) : (
          <View style={styles.brandChips}>
            {customBrands.map((brand) => (
              <TouchableOpacity
                key={brand}
                style={styles.brandChip}
                onPress={() => handleRemoveBrand(brand)}
              >
                <Text style={styles.brandChipText}>{brand} ✕</Text>
              </TouchableOpacity>
            ))}
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
  brandCount: {
    ...Typography.bodySmall,
    color: Colors.textMuted,
    marginBottom: Spacing.md,
  },
  brandInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  brandInput: {
    flex: 1,
    backgroundColor: Colors.surfaceLight,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    color: Colors.text,
    fontSize: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  brandChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  brandChip: {
    backgroundColor: Colors.surfaceLight,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs + 2,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  brandChipText: {
    color: Colors.text,
    fontSize: 13,
  },
});
