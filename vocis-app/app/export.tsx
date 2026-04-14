import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Colors, Typography, Spacing, BorderRadius } from '../src/constants/theme';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { ExportFormat, InventoryItem } from '../src/types';
import { getSessionItems } from '../src/db/database';
import { generateCSV, getExportFilename } from '../src/services/csvGenerator';
import { deliverCSV, DeliveryMethod } from '../src/services/exportDelivery';
import { ExportSecurity } from '../src/services/exportSecurity';

const FORMATS: { key: ExportFormat; label: string; description: string }[] = [
  {
    key: 'custom',
    label: 'Custom Excel',
    description: 'Title + Variant Price columns',
  },
  {
    key: 'shopify',
    label: 'Shopify',
    description: 'Title, Price, SKU, Tags',
  },
  {
    key: 'ebay',
    label: 'eBay / Depop',
    description: 'Title, Price, Size, Condition',
  },
];

const METHODS: { key: DeliveryMethod; label: string; icon: string }[] = [
  { key: 'email', label: 'Email', icon: 'Mail' },
  { key: 'download', label: 'Save to Files', icon: 'Download' },
  { key: 'share', label: 'Share', icon: 'Share' },
];

export default function ExportScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('custom');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<DeliveryMethod | null>(null);

  useEffect(() => {
    if (sessionId) loadItems();
  }, [sessionId]);

  async function loadItems() {
    if (!sessionId) return;
    setLoading(true);
    const data = await getSessionItems(sessionId);
    setItems(data);
    setLoading(false);
  }

  async function handleExport(method: DeliveryMethod) {
    if (items.length === 0) {
      Alert.alert('No Items', 'This session has no items to export.');
      return;
    }

    // Authenticate if PIN lock is enabled
    const authenticated = await ExportSecurity.authenticate();
    if (!authenticated) {
      Alert.alert('Authentication Required', 'You must authenticate to export data.');
      return;
    }

    // Warn about unencrypted channels
    if (method !== 'download') {
      const proceed = await ExportSecurity.warnUnencryptedChannel(method);
      if (!proceed) return;
    }

    setExporting(method);
    try {
      const csv = generateCSV(items, selectedFormat);
      const result = await deliverCSV(csv, selectedFormat, method);

      if (result.success) {
        Alert.alert('Exported', result.message, [
          { text: 'OK', onPress: () => router.back() },
        ]);
      } else {
        Alert.alert('Export Failed', result.message);
      }
    } catch {
      Alert.alert('Error', 'Something went wrong during export. Please try again.');
    } finally {
      setExporting(null);
    }
  }

  // Preview info
  const filename = getExportFilename(selectedFormat);
  const totalValue = items.reduce((sum, item) => sum + item.price, 0);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      bounces={false}
    >
      {/* Session summary */}
      <View style={styles.summary}>
        <Text style={styles.summaryText}>
          {items.length} {items.length === 1 ? 'item' : 'items'}
        </Text>
        <Text style={styles.summaryValue}>${totalValue.toFixed(2)}</Text>
      </View>

      {/* Format selection */}
      <Text style={styles.sectionTitle}>Export Format</Text>
      {FORMATS.map((format) => {
        const selected = selectedFormat === format.key;
        return (
          <TouchableOpacity
            key={format.key}
            onPress={() => setSelectedFormat(format.key)}
            activeOpacity={0.7}
          >
            <Card
              style={{
                ...styles.formatCard,
                ...(selected ? styles.formatCardSelected : {}),
              }}
            >
              <View style={styles.formatRow}>
                <View style={styles.radio}>
                  {selected && <View style={styles.radioInner} />}
                </View>
                <View style={styles.formatInfo}>
                  <Text style={styles.formatLabel}>{format.label}</Text>
                  <Text style={styles.formatDesc}>{format.description}</Text>
                </View>
              </View>
            </Card>
          </TouchableOpacity>
        );
      })}

      {/* File preview */}
      <View style={styles.filePreview}>
        <Text style={styles.fileLabel}>File</Text>
        <Text style={styles.fileName}>{filename}</Text>
      </View>

      {/* Delivery methods */}
      <Text style={[styles.sectionTitle, { marginTop: Spacing.lg }]}>
        Delivery Method
      </Text>
      <View style={styles.methods}>
        {METHODS.map((method) => (
          <Button
            key={method.key}
            title={method.label}
            onPress={() => handleExport(method.key)}
            variant={method.key === 'share' ? 'primary' : 'outline'}
            size="large"
            loading={exporting === method.key}
            disabled={exporting !== null || loading || items.length === 0}
            style={styles.methodButton}
          />
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  summary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  summaryText: {
    ...Typography.body,
  },
  summaryValue: {
    ...Typography.price,
  },
  sectionTitle: {
    ...Typography.heading3,
    marginBottom: Spacing.md,
  },
  formatCard: {
    marginBottom: Spacing.sm,
  },
  formatCardSelected: {
    borderColor: Colors.primary,
    borderWidth: 2,
  },
  formatRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: Colors.primary,
    marginRight: Spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.primary,
  },
  formatInfo: {
    flex: 1,
  },
  formatLabel: {
    ...Typography.body,
    fontWeight: '600',
  },
  formatDesc: {
    ...Typography.bodySmall,
    marginTop: 2,
  },
  filePreview: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    marginTop: Spacing.sm,
  },
  fileLabel: {
    ...Typography.label,
  },
  fileName: {
    ...Typography.bodySmall,
    fontFamily: 'monospace',
    color: Colors.textSecondary,
  },
  methods: {
    gap: Spacing.sm,
  },
  methodButton: {
    width: '100%',
  },
});
