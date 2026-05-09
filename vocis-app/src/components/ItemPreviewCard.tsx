import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { Colors, Typography, Spacing, BorderRadius } from '../constants/theme';
import { Card } from './Card';
import { InventoryItem } from '../types';

interface ItemPreviewCardProps {
  item: InventoryItem;
  editable?: boolean;
  onSave?: (updated: InventoryItem) => void;
  onDelete?: () => void;
  onCancel?: () => void;
  /** The original transcript heard by STT. Shown via a "what was heard" toggle. */
  rawTranscript?: string;
}

export function ItemPreviewCard({
  item,
  editable = false,
  onSave,
  onDelete,
  onCancel,
  rawTranscript,
}: ItemPreviewCardProps) {
  const [isEditing, setIsEditing] = useState(editable);
  const [draft, setDraft] = useState(item);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    setDraft(item);
  }, [item]);

  useEffect(() => {
    setIsEditing(editable);
  }, [editable]);

  function handleFieldChange(field: keyof InventoryItem, value: string) {
    setDraft((prev) => {
      const updated = { ...prev };
      if (field === 'price') {
        updated.price = parseFloat(value.replace(/[^0-9.]/g, '')) || 0;
      } else {
        (updated as Record<string, unknown>)[field] = value;
      }
      updated.raw_title = `(${updated.size}) ${updated.decade} ${updated.item_name}`;
      return updated;
    });
  }

  function handleSave() {
    onSave?.(draft);
    setIsEditing(false);
  }

  function handleCancel() {
    setDraft(item);
    setIsEditing(false);
    onCancel?.();
  }

  function renderField(label: string, field: keyof InventoryItem, value: string) {
    return (
      <View style={styles.field}>
        <Text style={styles.label}>{label}</Text>
        {isEditing ? (
          <TextInput
            style={styles.editableValue}
            value={value}
            onChangeText={(text) => handleFieldChange(field, text)}
            placeholderTextColor={Colors.textMuted}
            returnKeyType="next"
          />
        ) : (
          <TouchableOpacity onPress={() => setIsEditing(true)}>
            <Text style={styles.value}>{value}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <Card style={styles.container}>
      <View style={styles.titleRow}>
        <Text style={styles.title} numberOfLines={1}>
          {draft.raw_title}
        </Text>
        {!isEditing && (
          <TouchableOpacity
            onPress={() => setIsEditing(true)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.editIcon}>Edit</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.fields}>
        {renderField('Size', 'size', draft.size)}
        {renderField('Decade', 'decade', draft.decade)}
        {renderField('Item', 'item_name', draft.item_name)}
        <View style={styles.field}>
          <Text style={styles.label}>Price</Text>
          {isEditing ? (
            <TextInput
              style={[styles.editableValue, styles.priceInput]}
              value={`${draft.price}`}
              onChangeText={(text) => handleFieldChange('price', text)}
              keyboardType="decimal-pad"
              placeholderTextColor={Colors.textMuted}
              returnKeyType="done"
            />
          ) : (
            <TouchableOpacity onPress={() => setIsEditing(true)}>
              <Text style={styles.priceText}>${draft.price.toFixed(2)}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Raw transcript reveal — lets the user check what was actually heard
          without re-recording. */}
      {rawTranscript ? (
        <View style={styles.rawSection}>
          <TouchableOpacity onPress={() => setShowRaw((s) => !s)}>
            <Text style={styles.rawToggle}>
              {showRaw ? 'Hide' : 'Show'} what was heard
            </Text>
          </TouchableOpacity>
          {showRaw && (
            <Text style={styles.rawTranscript}>"{rawTranscript}"</Text>
          )}
        </View>
      ) : null}

      {/* Action buttons */}
      {(isEditing || onDelete) && (
        <View style={styles.actions}>
          {onDelete && (
            <TouchableOpacity style={styles.deleteButton} onPress={onDelete}>
              <Text style={styles.deleteText}>Delete</Text>
            </TouchableOpacity>
          )}
          {isEditing && onSave && (
            <View style={styles.editActions}>
              <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
                <Text style={styles.saveText}>Save</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  title: {
    ...Typography.heading3,
    flex: 1,
    marginRight: Spacing.sm,
  },
  editIcon: {
    color: Colors.primaryLight,
    fontSize: 14,
    fontWeight: '600',
  },
  fields: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  field: {
    width: '47%',
    marginBottom: Spacing.sm,
  },
  label: {
    ...Typography.label,
    marginBottom: Spacing.xs,
  },
  value: {
    ...Typography.body,
    paddingVertical: Spacing.xs,
  },
  editableValue: {
    ...Typography.body,
    backgroundColor: Colors.surfaceLight,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs + 2,
    borderWidth: 1,
    borderColor: Colors.primaryDark,
    color: Colors.text,
  },
  priceInput: {
    color: Colors.accent,
    fontWeight: '700',
  },
  priceText: {
    ...Typography.price,
    paddingVertical: Spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  deleteButton: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
  },
  deleteText: {
    color: Colors.error,
    fontWeight: '600',
    fontSize: 14,
  },
  editActions: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginLeft: 'auto',
  },
  cancelButton: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
  },
  cancelText: {
    color: Colors.textSecondary,
    fontWeight: '600',
    fontSize: 14,
  },
  saveButton: {
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.xs + 2,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.sm,
  },
  saveText: {
    color: Colors.text,
    fontWeight: '600',
    fontSize: 14,
  },
  rawSection: {
    marginTop: Spacing.md,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  rawToggle: {
    color: Colors.primaryLight,
    fontSize: 12,
    fontWeight: '600',
  },
  rawTranscript: {
    fontStyle: 'italic',
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
  },
});
