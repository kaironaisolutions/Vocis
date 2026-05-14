import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Alert,
  ScrollView,
  FlatList,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { Colors, Typography, Spacing, BorderRadius, Shadows } from '../src/constants/theme';
import { Button } from '../src/components/Button';
import { ItemPreviewCard } from '../src/components/ItemPreviewCard';
import { WaveformIndicator } from '../src/components/WaveformIndicator';
import { useRecording } from '../src/hooks/useRecording';
import { useSecurity } from '../src/context/SecurityContext';
import { createSession, addItem } from '../src/db/database';
import { InventoryItem } from '../src/types';
import { mergeItems, ParsedItem } from '../src/services/voiceParser';
import { validateItem, sanitizeField } from '../src/services/validation';
import { confirmDestructive } from '../src/services/confirm';

// --- Rate limits for recording sessions ---
const MAX_ITEMS_PER_SESSION = 200;
const MAX_ITEMS_PER_MINUTE = 15;
const MAX_SESSION_DURATION_MS = 30 * 60 * 1000; // 30 minutes
const SAVED_FLASH_MS = 1500; // how long the "✓ Saved" toast stays visible

// Soft web-audio chime played on each successful save — hands-free
// confirmation so the user doesn't have to look at the screen between
// items. Uses its own short-lived AudioContext to avoid touching the
// recording context.
function playSaveChime() {
  if (typeof window === 'undefined') return;
  const AC = (window as unknown as { AudioContext?: typeof AudioContext })
    .AudioContext;
  if (!AC) return;
  try {
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880; // A5
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.02);
    gain.gain.linearRampToValueAtTime(0, now + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.2);
    osc.onended = () => { try { ctx.close(); } catch {} };
  } catch {
    // Best-effort — silence is acceptable.
  }
}

interface LoggedItem {
  parsed: ParsedItem;
  id: string;
}

const RECORDING_TIPS = [
  'Speak clearly at a normal pace.',
  'Hold the phone 6–12 inches from your mouth.',
  'Say size, decade, item name, then price.',
  'Example: "Medium, nineties, Polo bomber, $75".',
  'Quiet rooms give better results.',
  'Tap Stop when you finish — or pause and we\'ll do it for you.',
];

export default function RecordScreen() {
  const router = useRouter();
  const recordingHook = useRecording();
  const { isCompromised } = useSecurity();

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [pendingItem, setPendingItem] = useState<ParsedItem | null>(null);
  const [loggedItems, setLoggedItems] = useState<LoggedItem[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tipDismissed, setTipDismissed] = useState(false);
  const [tipIndex] = useState(() => Math.floor(Math.random() * RECORDING_TIPS.length));
  const [savedFlash, setSavedFlash] = useState<string | null>(null);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const savedFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionStartTime = useRef<number>(0);
  const recentItemTimestamps = useRef<number[]>([]);
  const scrollRef = useRef<ScrollView>(null);
  // pendingItemRef mirrors pendingItem so long-lived event handlers
  // (recognition.onresult is bound once, then keeps firing for the entire
  // recording session) can read the LATEST pending state instead of the
  // stale value captured in their closure.
  const pendingItemRef = useRef<ParsedItem | null>(null);
  useEffect(() => {
    pendingItemRef.current = pendingItem;
  }, [pendingItem]);

  // --- Pulse animation ---
  const recording = recordingHook.isRecording;

  useEffect(() => {
    if (recording) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.15, duration: 1000, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [recording]);

  // --- Sync recording hook → screen state ---
  useEffect(() => {
    if (recordingHook.pendingItem) handleParsedItem(recordingHook.pendingItem);
  }, [recordingHook.pendingItem]);

  useEffect(() => {
    if (recordingHook.confirmedItems.length > 0) {
      for (const item of recordingHook.confirmedItems) confirmItem(item);
      recordingHook.consumeConfirmedItems();
    }
  }, [recordingHook.confirmedItems]);

  useEffect(() => {
    if (recordingHook.partialTranscript) {
      setLiveTranscript(recordingHook.partialTranscript);
    }
  }, [recordingHook.partialTranscript]);

  useEffect(() => {
    if (recordingHook.error) setErrorMsg(recordingHook.error);
  }, [recordingHook.error]);

  // --- Show errors ---
  useEffect(() => {
    if (errorMsg) {
      if (Platform.OS === 'web') {
        window.alert(errorMsg);
        setErrorMsg(null);
      } else {
        Alert.alert('Error', errorMsg, [{ text: 'OK', onPress: () => setErrorMsg(null) }]);
      }
    }
  }, [errorMsg]);

  // --- Startup connectivity diagnostic (dev only — reads proxy config and tests /health + /token) ---
  useEffect(() => {
    const proxyUrl = (Constants.expoConfig?.extra?.sttProxyUrl as string) || '';
    console.log('[DIAG] expoConfig.extra:', JSON.stringify(Constants.expoConfig?.extra));
    console.log('[DIAG] sttProxyUrl:', proxyUrl || '(EMPTY — proxy disabled)');

    if (!proxyUrl) {
      console.warn('[DIAG] sttProxyUrl is empty. App will try direct ElevenLabs connection.');
      return;
    }

    (async () => {
      try {
        const healthRes = await fetch(`${proxyUrl}/health`);
        const health = await healthRes.json();
        console.log('[DIAG] /health:', JSON.stringify(health));
      } catch (e) {
        console.error('[DIAG] /health fetch failed:', e);
      }

      try {
        const tokenRes = await fetch(`${proxyUrl}/token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Device-ID': (Constants as any).installationId || Constants.sessionId || 'diag-test',
          },
        });
        console.log('[DIAG] /token status:', tokenRes.status);
        const tokenBody = await tokenRes.text();
        console.log('[DIAG] /token body:', tokenBody.slice(0, 200));
      } catch (e) {
        console.error('[DIAG] /token fetch failed:', e);
      }
    })();
  }, []);

  // --- Cleanup on unmount ---
  useEffect(() => {
    return () => {
      if (savedFlashTimer.current) clearTimeout(savedFlashTimer.current);
    };
  }, []);

  // --- Session duration guard ---
  useEffect(() => {
    if (!recording || sessionStartTime.current === 0) return;
    const timer = setTimeout(() => {
      setErrorMsg('Maximum session duration (30 minutes) reached.');
      stopListening();
    }, MAX_SESSION_DURATION_MS);
    return () => clearTimeout(timer);
  }, [recording]);

  // --- Rate limit check ---
  function checkItemRateLimit(): { allowed: boolean; reason?: string } {
    // Max items per session
    if (loggedItems.length >= MAX_ITEMS_PER_SESSION) {
      return { allowed: false, reason: `Maximum ${MAX_ITEMS_PER_SESSION} items per session reached.` };
    }

    // Max items per minute (prevent runaway/abuse)
    const oneMinuteAgo = Date.now() - 60 * 1000;
    recentItemTimestamps.current = recentItemTimestamps.current.filter((t) => t > oneMinuteAgo);
    if (recentItemTimestamps.current.length >= MAX_ITEMS_PER_MINUTE) {
      return { allowed: false, reason: `Slow down — maximum ${MAX_ITEMS_PER_MINUTE} items per minute.` };
    }

    return { allowed: true };
  }

  // --- Session management ---
  async function ensureSession(): Promise<string> {
    if (sessionId) return sessionId;
    const id = await createSession();
    setSessionId(id);
    return id;
  }

  // --- Haptics: silent no-op on web; ignored on devices without a Taptic engine. ---
  const haptic = useCallback(
    (
      kind:
        | 'recordStart'
        | 'recordStop'
        | 'parseSuccess'
        | 'parseError'
    ) => {
      if (Platform.OS === 'web') return;
      try {
        switch (kind) {
          case 'recordStart':
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            break;
          case 'recordStop':
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            break;
          case 'parseSuccess':
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            break;
          case 'parseError':
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            break;
        }
      } catch {
        // No-op on devices without haptics support.
      }
    },
    []
  );

  // --- Start/Stop ---
  async function handleStartStop() {
    if (recording) {
      haptic('recordStop');
      stopListening();
    } else {
      haptic('recordStart');
      await ensureSession();
      sessionStartTime.current = Date.now();
      await recordingHook.startRecording();
    }
  }

  function stopListening() {
    recordingHook.stopRecording();
    // If there's a pending item, confirm it
    if (pendingItem) {
      confirmItem(pendingItem);
    }
  }

  // --- Handle a parsed item ---
  // Called when the hook reports a partial-derived pending item for live
  // preview only. Final items go through recordingHook.confirmedItems
  // which auto-saves directly — no manual confirm step in this flow.
  function handleParsedItem(parsed: ParsedItem) {
    const previous = pendingItemRef.current;
    const merged = previous ? mergeItems(previous, parsed) : parsed;
    pendingItemRef.current = merged;
    setPendingItem(merged);
  }

  // --- Confirm and save item ---
  async function confirmItem(item: ParsedItem) {
    // Sanitize and validate FIRST — atomic guard against race conditions.
    // Null fields fall through to placeholders that validation flags as
    // warnings/errors; an item with item_name === null fails validation.
    const sanitized = {
      size: sanitizeField(item.size ?? '?'),
      decade: sanitizeField(item.decade ?? '?'),
      item_name: sanitizeField(item.item_name ?? ''),
      price: item.price ?? 0,
      raw_title: sanitizeField(item.raw_title),
    };

    const validation = validateItem(sanitized);
    if (!validation.valid) {
      // Don't auto-confirm invalid items — keep as pending for manual edit
      return;
    }

    // Rate limit check
    const rateCheck = checkItemRateLimit();
    if (!rateCheck.allowed) {
      setErrorMsg(rateCheck.reason!);
      return;
    }

    const sid = await ensureSession();
    setSaving(true);
    try {
      const id = await addItem({
        size: sanitized.size,
        decade: sanitized.decade,
        item_name: sanitized.item_name,
        price: sanitized.price,
        raw_title: sanitizeField(sanitized.raw_title),
        session_id: sid,
      });

      recentItemTimestamps.current.push(Date.now());
      const persisted: ParsedItem = {
        ...item,
        size: sanitized.size,
        decade: sanitized.decade,
        item_name: sanitized.item_name,
        price: sanitized.price,
        raw_title: sanitized.raw_title,
      };
      setLoggedItems((prev) => [...prev, { parsed: persisted, id }]);
      pendingItemRef.current = null;
      setPendingItem(null);
      setLiveTranscript('');
      recordingHook.clearPendingItem();
      haptic('parseSuccess');
      // Hands-free confirmation — chime + on-screen flash for ~1.5s. The
      // user doesn't need to look at the screen to know the save landed.
      playSaveChime();
      if (savedFlashTimer.current) clearTimeout(savedFlashTimer.current);
      setSavedFlash(persisted.item_name ?? 'Item');
      savedFlashTimer.current = setTimeout(() => setSavedFlash(null), SAVED_FLASH_MS);
    } catch {
      setErrorMsg('Failed to save item.');
      haptic('parseError');
    } finally {
      setSaving(false);
    }
  }

  function discardPending() {
    pendingItemRef.current = null;
    setPendingItem(null);
    setLiveTranscript('');
    recordingHook.clearPendingItem();
  }

  // Clear is a confirmed reset — discardPending without the prompt is used
  // internally (after save, on Try Again, etc.). The Clear affordance lets
  // the user reset accumulated fields when partial transcripts have built
  // up something they don't want to confirm.
  function handleClear() {
    confirmDestructive(
      'Clear Fields',
      'Start over with empty fields?',
      'Clear',
      () => discardPending()
    );
  }

  async function handleDone() {
    stopListening();
    if (sessionId && loggedItems.length > 0) {
      router.replace(`/session/${sessionId}`);
    } else {
      router.back();
    }
  }

  // --- Render ---
  const totalValue = loggedItems.reduce((sum, i) => sum + (i.parsed.price ?? 0), 0);

  // Status label derived from the recording hook's phase.
  let statusLabel: string;
  switch (recordingHook.phase) {
    case 'connecting':
      statusLabel = 'Connecting…';
      break;
    case 'listening':
      statusLabel = pendingItem
        ? 'Item detected'
        : liveTranscript
          ? 'Hearing you…'
          : 'Listening…';
      break;
    case 'transcribing':
      statusLabel = 'Transcribing…';
      break;
    case 'error':
      statusLabel = 'Recording error';
      break;
    default:
      statusLabel = loggedItems.length > 0 ? 'Session paused' : 'Ready';
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.container}
      contentContainerStyle={styles.content}
      bounces={false}
    >
      {/* Status bar */}
      <View style={styles.statusBar}>
        <View style={[styles.statusDot, recording && styles.statusDotActive]} />
        <Text style={styles.statusText}>{statusLabel}</Text>
        <Text style={styles.itemCount}>
          {loggedItems.length} {loggedItems.length === 1 ? 'item' : 'items'}
          {totalValue > 0 ? ` · $${totalValue.toFixed(0)}` : ''}
        </Text>
      </View>

      {/* Transcribing overlay — shows after Stop while we wait for the
          ElevenLabs transcript to come back. */}
      {recordingHook.phase === 'transcribing' && (
        <View style={styles.transcribingBanner}>
          <ActivityIndicator size="small" color={Colors.accent} />
          <Text style={styles.transcribingText}>Transcribing…</Text>
        </View>
      )}

      {/* One-shot recording tip — shown only when the screen is idle. */}
      {!recording &&
        !pendingItem &&
        loggedItems.length === 0 &&
        !tipDismissed && (
          <View style={styles.tipCard}>
            <Text style={styles.tipText}>Tip: {RECORDING_TIPS[tipIndex]}</Text>
            <TouchableOpacity onPress={() => setTipDismissed(true)}>
              <Text style={styles.tipDismiss}>Got it</Text>
            </TouchableOpacity>
          </View>
        )}

      {/* Mic button */}
      <View style={styles.micArea}>
        {isCompromised ? (
          <View style={[styles.micButton, styles.micButtonDisabled]}>
            <View style={[styles.micInner, styles.micInnerDisabled]}>
              <Text style={[styles.micIcon, styles.micIconDisabled]}>Locked</Text>
            </View>
          </View>
        ) : (
          <TouchableOpacity onPress={handleStartStop} activeOpacity={0.7}>
            <Animated.View
              style={[
                styles.micButton,
                recording && styles.micButtonActive,
                { transform: [{ scale: recording ? pulseAnim : 1 }] },
              ]}
            >
              <View style={[styles.micInner, recording && styles.micInnerActive]}>
                <Text style={styles.micIcon}>
                  {recording ? 'End Session' : 'Start'}
                </Text>
              </View>
            </Animated.View>
          </TouchableOpacity>
        )}

        {isCompromised && (
          <Text style={styles.securityWarning}>
            Recording is disabled on this device for security reasons.
          </Text>
        )}

        <WaveformIndicator active={recording && !isCompromised} />

        {liveTranscript && !pendingItem ? (
          <View style={styles.transcriptBubble}>
            <Text style={styles.transcriptText}>{liveTranscript}</Text>
          </View>
        ) : recording && !pendingItem ? (
          <Text style={styles.hintText}>Say: Size, Decade, Item Name, Price</Text>
        ) : !recording && !pendingItem && loggedItems.length === 0 ? (
          <Text style={styles.hintText}>Tap Start and speak your items</Text>
        ) : null}

      </View>

      {/* Saved-flash toast — hands-free confirmation that the previous
          utterance landed in the session list. Fades out after ~1.5s. */}
      {savedFlash && (
        <View style={styles.savedFlash}>
          <Text style={styles.savedFlashText}>✓ {savedFlash}</Text>
        </View>
      )}

      {/* Pending item preview */}
      {pendingItem && (
        <View style={styles.previewSection}>
          <View style={styles.previewHeader}>
            <Text style={styles.previewLabel}>HEARING</Text>
          </View>
          <ItemPreviewCard
            item={{
              id: '',
              size: pendingItem.size ?? '?',
              decade: pendingItem.decade ?? '?',
              item_name: pendingItem.item_name ?? 'Unknown Item',
              price: pendingItem.price ?? 0,
              raw_title: pendingItem.raw_title,
              session_id: sessionId || '',
              logged_at: new Date().toISOString(),
            }}
            editable={false}
            rawTranscript={pendingItem.raw_transcript}
          />
        </View>
      )}

      {/* Logged items feed */}
      {loggedItems.length > 0 && (
        <View style={styles.feedSection}>
          <Text style={styles.feedTitle}>Logged Items</Text>
          {loggedItems.map((item, index) => (
            <View key={item.id} style={styles.feedItem}>
              <Text style={styles.feedIndex}>{index + 1}</Text>
              <View style={styles.feedDetails}>
                <Text style={styles.feedName} numberOfLines={1}>
                  {item.parsed.raw_title}
                </Text>
                <Text style={styles.feedPrice}>${(item.parsed.price ?? 0).toFixed(2)}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Bottom actions */}
      <View style={styles.doneArea}>
        {!pendingItem && loggedItems.length > 0 && (
          <Button
            title={recording ? `Done (${loggedItems.length} items)` : `Review & Export (${loggedItems.length})`}
            onPress={handleDone}
            variant="primary"
            size="large"
            style={styles.doneButton}
          />
        )}
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
    flexGrow: 1,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.xxl,
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
    paddingVertical: Spacing.lg,
    gap: Spacing.md,
  },
  micButton: {
    width: 120,
    height: 120,
    borderRadius: 60,
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
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: Colors.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  micInnerActive: {
    backgroundColor: Colors.recording,
  },
  micIcon: {
    color: Colors.text,
    fontSize: 16,
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
  webNote: {
    ...Typography.bodySmall,
    color: Colors.textMuted,
    fontSize: 11,
  },
  micButtonDisabled: {
    opacity: 0.4,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  micInnerDisabled: {
    backgroundColor: Colors.surfaceLight,
  },
  micIconDisabled: {
    color: Colors.textMuted,
  },
  securityWarning: {
    ...Typography.bodySmall,
    color: Colors.error,
    textAlign: 'center',
    paddingHorizontal: Spacing.lg,
  },
  previewSection: {
    marginTop: Spacing.sm,
  },
  previewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  previewLabel: {
    ...Typography.label,
  },
  savedFlash: {
    backgroundColor: '#22c55e',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    alignItems: 'center',
  },
  savedFlashText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
  autoConfirmHint: {
    ...Typography.bodySmall,
    color: Colors.accent,
    fontSize: 12,
    fontWeight: '600',
  },
  previewHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  clearButtonText: {
    ...Typography.bodySmall,
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  lowConfidenceWarning: {
    backgroundColor: '#FFF3CD',
    borderRadius: BorderRadius.sm,
    padding: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  warningText: {
    color: '#856404',
    fontSize: 12,
    textAlign: 'center',
  },
  transcribingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surfaceLight,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.sm,
  },
  transcribingText: {
    ...Typography.bodySmall,
    color: Colors.accent,
  },
  tipCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surfaceLight,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tipText: {
    ...Typography.bodySmall,
    flex: 1,
  },
  tipDismiss: {
    ...Typography.bodySmall,
    color: Colors.primaryLight,
    fontWeight: '600',
    marginLeft: Spacing.md,
  },
  retryRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  retryButton: {
    flex: 1,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surfaceLight,
    borderRadius: BorderRadius.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  retryText: {
    ...Typography.bodySmall,
    fontWeight: '600',
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
  feedSection: {
    marginTop: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  feedTitle: {
    ...Typography.label,
    marginBottom: Spacing.sm,
  },
  feedItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  feedIndex: {
    ...Typography.bodySmall,
    color: Colors.textMuted,
    width: 24,
    textAlign: 'center',
  },
  feedDetails: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  feedName: {
    ...Typography.body,
    flex: 1,
    fontSize: 14,
    marginRight: Spacing.sm,
  },
  feedPrice: {
    ...Typography.price,
    fontSize: 14,
  },
  doneArea: {
    paddingVertical: Spacing.lg,
  },
  doneButton: {
    width: '100%',
  },
});
