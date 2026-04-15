import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Alert, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Colors, Typography, Spacing } from '../../src/constants/theme';
import { Button } from '../../src/components/Button';
import { ItemPreviewCard } from '../../src/components/ItemPreviewCard';
import { getSessionItems, deleteItem, updateItem } from '../../src/db/database';
import { InventoryItem } from '../../src/types';
import { validateItem, sanitizeField } from '../../src/services/validation';

export default function SessionReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      if (!id) {
        router.replace('/');
        return;
      }
      loadItems();
    }, [id])
  );

  async function loadItems() {
    if (!id) return;
    setLoading(true);
    const data = await getSessionItems(id);
    setItems(data);
    setLoading(false);
  }

  async function handleSave(updated: InventoryItem) {
    // Sanitize and validate edited values before saving
    const sanitized: InventoryItem = {
      ...updated,
      size: sanitizeField(updated.size),
      decade: sanitizeField(updated.decade),
      item_name: sanitizeField(updated.item_name),
      raw_title: sanitizeField(updated.raw_title),
    };

    const validation = validateItem(sanitized);
    if (!validation.valid) {
      Alert.alert('Validation Error', validation.errors.join('\n'));
      return;
    }

    try {
      await updateItem(sanitized);
      setItems((prev) =>
        prev.map((item) => (item.id === sanitized.id ? sanitized : item))
      );
    } catch {
      Alert.alert('Error', 'Failed to save changes.');
    }
  }

  async function handleDelete(itemId: string) {
    Alert.alert('Delete Item', 'Remove this item from the session?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteItem(itemId);
          setItems((prev) => prev.filter((i) => i.id !== itemId));
        },
      },
    ]);
  }

  async function handleDeleteAll() {
    Alert.alert(
      'Delete All Items',
      `Remove all ${items.length} items from this session?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All',
          style: 'destructive',
          onPress: async () => {
            for (const item of items) {
              await deleteItem(item.id);
            }
            setItems([]);
          },
        },
      ]
    );
  }

  // Calculate session totals
  const totalValue = items.reduce((sum, item) => sum + item.price, 0);

  return (
    <View style={styles.container}>
      {/* Summary header */}
      <View style={styles.summary}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{items.length}</Text>
          <Text style={styles.summaryLabel}>
            {items.length === 1 ? 'Item' : 'Items'}
          </Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, { color: Colors.accent }]}>
            ${totalValue.toFixed(2)}
          </Text>
          <Text style={styles.summaryLabel}>Total Value</Text>
        </View>
      </View>

      {/* Items list */}
      {loading ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Loading...</Text>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No items in this session.</Text>
          <Button
            title="Go Back"
            onPress={() => router.replace('/')}
            variant="secondary"
            style={{ marginTop: Spacing.md }}
          />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ItemPreviewCard
              item={item}
              onSave={handleSave}
              onDelete={() => handleDelete(item.id)}
            />
          )}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={
            items.length > 1 ? (
              <Button
                title="Delete All Items"
                onPress={handleDeleteAll}
                variant="danger"
                size="small"
                style={styles.deleteAllButton}
              />
            ) : null
          }
        />
      )}

      {/* Bottom export action */}
      {items.length > 0 && (
        <View style={styles.bottomActions}>
          <Button
            title="Export CSV"
            onPress={() =>
              router.push({ pathname: '/export', params: { sessionId: id } })
            }
            size="large"
            style={styles.exportButton}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.md,
  },
  backButton: {
    paddingVertical: Spacing.sm,
  },
  backText: {
    color: Colors.primaryLight,
    fontSize: 14,
    fontWeight: '600',
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.lg,
    gap: Spacing.lg,
  },
  summaryItem: {
    alignItems: 'center',
  },
  summaryValue: {
    ...Typography.heading1,
  },
  summaryLabel: {
    ...Typography.label,
    marginTop: Spacing.xs,
  },
  summaryDivider: {
    width: 1,
    height: 40,
    backgroundColor: Colors.border,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    ...Typography.bodySmall,
  },
  list: {
    paddingBottom: 120,
  },
  deleteAllButton: {
    alignSelf: 'center',
    marginTop: Spacing.md,
    marginBottom: Spacing.lg,
  },
  bottomActions: {
    position: 'absolute',
    bottom: Spacing.xl,
    left: Spacing.md,
    right: Spacing.md,
  },
  exportButton: {
    width: '100%',
  },
});
