import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Alert,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Typography, Spacing, BorderRadius, Shadows } from '../src/constants/theme';
import { Button } from '../src/components/Button';
import { ItemPreviewCard } from '../src/components/ItemPreviewCard';
import { WaveformIndicator } from '../src/components/WaveformIndicator';
import { useRecording } from '../src/hooks/useRecording';
import { createSession, addItem } from '../src/db/database';
import { InventoryItem } from '../src/types';
import { ParsedItem } from '../src/services/voiceParser';
import { validateItem, sanitizeField } from '../src/services/validation';

export default function RecordScreen() {
  const router = useRouter();
  const {
    isRecording,
    connectionState,
    partialTranscript,
    currentItem,
    error,
    startRecording,
    stopRecording,
    clearCurrentItem,
    clearError,
  } = useRecording();

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [itemCount, setItemCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Start pulse animation when recording
  React.useEffect(() => {
    if (isRecording) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.15,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [isRecording]);

  // Show errors as alerts
  React.useEffect(() => {
    if (error) {
      Alert.alert('Error', error, [{ text: 'OK', onPress: clearError }]);
    }
  }, [error]);

  async function handleStartRecording() {
    if (!sessionId) {
      const id = await createSession();
      setSessionId(id);
    }
    await startRecording();
  }

  async function handleConfirmItem(item: ParsedItem) {
    if (!sessionId || saving) return;

    // Sanitize fields
    const sanitized = {
      ...item,
      size: sanitizeField(item.size),
      decade: sanitizeField(item.decade),
      item_name: sanitizeField(item.item_name),
    };

    // Validate all fields
    const validation = validateItem(sanitized);

    if (!validation.valid) {
      Alert.alert(
        'Invalid Fields',
        validation.errors.join('\n') + '\n\nPlease edit the fields before saving.'
      );
      return;
    }

    if (validation.warnings.length > 0) {
      Alert.alert(
        'Please Verify',
        validation.warnings.join('\n'),
        [
          { text: 'Edit', style: 'cancel' },
          { text: 'Save Anyway', onPress: () => saveItem(sanitized) },
        ]
      );
      return;
    }

    await saveItem(sanitized);
  }

  async function saveItem(item: ParsedItem) {
    if (!sessionId) return;
    setSaving(true);
    try {
      await addItem({
        size: sanitizeField(item.size),
        decade: sanitizeField(item.decade),
        item_name: sanitizeField(item.item_name),
        price: item.price,
        raw_title: sanitizeField(item.raw_title),
        session_id: sessionId,
      });
      setItemCount((prev) => prev + 1);
      clearCurrentItem();
    } catch {
      Alert.alert('Error', 'Failed to save item. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDone() {
    await stopRecording();
    if (sessionId && itemCount > 0) {
      router.replace(`/session/${sessionId}`);
    } else {
      router.back();
    }
  }

  const statusText = (() => {
    switch (connectionState) {
      case 'connecting':
        return 'Connecting...';
      case 'connected':
        return 'Listening...';
      case 'error':
        return 'Connection error';
      default:
        return 'Ready';
    }
  })();

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      bounces={false}
    >
      {/* Status bar */}
      <View style={styles.statusBar}>
        <View style={[styles.statusDot, connectionState === 'connected' && styles.statusDotActive]} />
        <Text style={styles.statusText}>{statusText}</Text>
        <Text style={styles.itemCount}>
          {itemCount} {itemCount === 1 ? 'item' : 'items'}
        </Text>
      </View>

      {/* Mic button area */}
      <View style={styles.micArea}>
        <TouchableOpacity
          onPress={isRecording ? stopRecording : handleStartRecording}
          activeOpacity={0.8}
        >
          <Animated.View
            style={[
              styles.micButton,
              isRecording && styles.micButtonActive,
              { transform: [{ scale: isRecording ? pulseAnim : 1 }] },
            ]}
          >
            <View style={styles.micInner}>
              <Text style={styles.micIcon}>{isRecording ? 'Stop' : 'Start'}</Text>
            </View>
          </Animated.View>
        </TouchableOpacity>

        <WaveformIndicator active={isRecording} />

        {partialTranscript ? (
          <View style={styles.transcriptBubble}>
            <Text style={styles.transcriptText}>{partialTranscript}</Text>
          </View>
        ) : isRecording ? (
          <Text style={styles.hintText}>Speak: Size, Decade, Item, Price</Text>
        ) : null}
      </View>

      {/* Preview card */}
      {currentItem && (
        <View style={styles.previewSection}>
          <Text style={styles.previewLabel}>Preview</Text>
          <ItemPreviewCard
            item={{
              id: '',
              ...currentItem,
              session_id: sessionId || '',
              logged_at: new Date().toISOString(),
            }}
            editable
            onCancel={clearCurrentItem}
          />
          <View style={styles.previewActions}>
            <Button
              title="Discard"
              onPress={clearCurrentItem}
              variant="secondary"
              size="medium"
              style={styles.discardButton}
            />
            <Button
              title="Confirm"
              onPress={() => handleConfirmItem(currentItem)}
              variant="primary"
              size="medium"
              loading={saving}
              style={styles.confirmButton}
            />
          </View>
        </View>
      )}

      {/* Bottom action */}
      {(isRecording || itemCount > 0) && (
        <View style={styles.doneArea}>
          <Button
            title={itemCount > 0 ? `Done (${itemCount} items)` : 'Cancel'}
            onPress={handleDone}
            variant={itemCount > 0 ? 'primary' : 'secondary'}
            size="large"
            style={styles.doneButton}
          />
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: Spacing.md,
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.textMuted,
  },
  statusDotActive: {
    backgroundColor: Colors.success,
  },
  statusText: {
    ...Typography.bodySmall,
    flex: 1,
  },
  itemCount: {
    ...Typography.bodySmall,
    color: Colors.accent,
    fontWeight: '600',
  },
  micArea: {
    alignItems: 'center',
    paddingVertical: Spacing.xxl,
    gap: Spacing.lg,
  },
  micButton: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: Colors.border,
    ...Shadows.card,
  },
  micButtonActive: {
    backgroundColor: 'rgba(255, 107, 107, 0.15)',
    borderColor: Colors.recording,
  },
  micInner: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: Colors.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  micIcon: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  transcriptBubble: {
    backgroundColor: Colors.surfaceLight,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    maxWidth: '90%',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  transcriptText: {
    ...Typography.body,
    fontStyle: 'italic',
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  hintText: {
    ...Typography.bodySmall,
    color: Colors.textMuted,
  },
  previewSection: {
    marginTop: Spacing.md,
  },
  previewLabel: {
    ...Typography.label,
    marginBottom: Spacing.sm,
  },
  previewActions: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  discardButton: {
    flex: 1,
  },
  confirmButton: {
    flex: 2,
  },
  doneArea: {
    paddingVertical: Spacing.xl,
  },
  doneButton: {
    width: '100%',
  },
});
