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
import { parseTranscription, splitMultipleItems, mergeItems, ParsedItem } from '../src/services/voiceParser';
import { validateItem, sanitizeField } from '../src/services/validation';
import { confirmDestructive } from '../src/services/confirm';

// --- Rate limits for recording sessions ---
const MAX_ITEMS_PER_SESSION = 200;
const MAX_ITEMS_PER_MINUTE = 15;
const MAX_SESSION_DURATION_MS = 30 * 60 * 1000; // 30 minutes
const AUTO_CONFIRM_DELAY_MS = 2500; // 2.5 seconds before auto-confirm

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
  const nativeRecording = useRecording();
  const { isCompromised } = useSecurity();

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [pendingItem, setPendingItem] = useState<ParsedItem | null>(null);
  const [loggedItems, setLoggedItems] = useState<LoggedItem[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tipDismissed, setTipDismissed] = useState(false);
  const [tipIndex] = useState(() => Math.floor(Math.random() * RECORDING_TIPS.length));

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const recognitionRef = useRef<any>(null);
  const autoConfirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const recording = Platform.OS === 'web' ? isListening : nativeRecording.isRecording;

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

  // --- Sync native recording: pending items ---
  useEffect(() => {
    if (Platform.OS !== 'web' && nativeRecording.pendingItem) {
      handleParsedItem(nativeRecording.pendingItem);
    }
  }, [nativeRecording.pendingItem]);

  // --- Sync native recording: auto-confirmed items ---
  useEffect(() => {
    if (Platform.OS !== 'web' && nativeRecording.confirmedItems.length > 0) {
      for (const item of nativeRecording.confirmedItems) {
        confirmItem(item);
      }
      nativeRecording.consumeConfirmedItems();
    }
  }, [nativeRecording.confirmedItems]);

  // --- Sync native recording: partial transcript ---
  useEffect(() => {
    if (Platform.OS !== 'web' && nativeRecording.partialTranscript) {
      setLiveTranscript(nativeRecording.partialTranscript);
    }
  }, [nativeRecording.partialTranscript]);

  useEffect(() => {
    if (Platform.OS !== 'web' && nativeRecording.error) {
      setErrorMsg(nativeRecording.error);
    }
  }, [nativeRecording.error]);

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
      if (recognitionRef.current) recognitionRef.current.stop();
      if (autoConfirmTimer.current) clearTimeout(autoConfirmTimer.current);
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
      if (Platform.OS === 'web') {
        startWebSpeech();
      } else {
        await nativeRecording.startRecording();
      }
    }
  }

  function stopListening() {
    if (Platform.OS === 'web') {
      if (recognitionRef.current) recognitionRef.current.stop();
      setIsListening(false);
    } else {
      nativeRecording.stopRecording();
    }
    // If there's a pending item, confirm it
    if (pendingItem) {
      confirmItem(pendingItem);
    }
  }

  // --- Web Speech API (continuous mode) ---
  function startWebSpeech() {
    const SpeechRecognition =
      (globalThis as any).SpeechRecognition || (globalThis as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setErrorMsg('Speech recognition not supported. Use Chrome or Edge.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;       // Keep listening until user stops
    recognition.interimResults = true;   // Show live transcript
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
      setLiveTranscript('');
    };

    recognition.onresult = (event: any) => {
      const lastResult = event.results[event.results.length - 1];
      const transcript = lastResult[0].transcript.trim();

      if (lastResult.isFinal) {
        // Final result — split and save items. Do NOT clear pendingItem
        // here: handleParsedItem merges incoming fields into whatever has
        // been accumulated so far. Clearing first would defeat the merge.
        setLiveTranscript('');
        console.log('[MERGE] Final transcript:', transcript);

        const items = splitMultipleItems(transcript);
        for (const itemText of items) {
          const parsed = parseTranscription(itemText);
          if (parsed.confidence.price) {
            confirmItem(parsed);
          } else {
            // Incomplete — show as pending for manual confirm
            handleParsedItem(parsed);
          }
        }
      } else {
        // Interim — visual feedback only, no saving
        setLiveTranscript(transcript);

        // Show preview of what's being parsed. Merge into the existing
        // pending item so previously detected fields aren't clobbered.
        const items = splitMultipleItems(transcript);
        const currentItem = items[items.length - 1] || '';
        if (currentItem) {
          const parsed = parseTranscription(currentItem);
          if (parsed.confidence.size || parsed.confidence.decade) {
            setPendingItem((prev) => (prev ? mergeItems(prev, parsed) : parsed));
          }
        }
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'not-allowed') {
        setErrorMsg('Microphone access denied. Allow mic access in browser settings.');
      } else if (event.error === 'no-speech') {
        // Silence — restart recognition to keep listening
        try { recognition.stop(); } catch {}
        setTimeout(() => {
          if (isListening) {
            try { recognition.start(); } catch {}
          }
        }, 100);
      } else if (event.error !== 'aborted') {
        setErrorMsg(`Speech error: ${event.error}`);
      }
    };

    recognition.onend = () => {
      // Auto-restart if user hasn't stopped
      // This handles Chrome's ~60s auto-cutoff for continuous recognition
      if (isListening) {
        setTimeout(() => {
          try { recognition.start(); } catch {}
        }, 100);
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      setErrorMsg('Failed to start speech recognition.');
    }
  }

  // --- Handle a parsed item ---
  function handleParsedItem(parsed: ParsedItem) {
    // Read the LATEST pending item from the ref — NOT the closure-captured
    // value. recognition.onresult is bound once at startWebSpeech() time and
    // then keeps invoking handleParsedItem for the lifetime of the session,
    // so any value read from this function's closure goes stale after the
    // first state update.
    const previous = pendingItemRef.current;

    const previousIsComplete =
      previous &&
      previous.confidence.size &&
      previous.confidence.price;

    if (previousIsComplete) {
      confirmItem(previous!);
    }

    if (autoConfirmTimer.current) {
      clearTimeout(autoConfirmTimer.current);
      autoConfirmTimer.current = null;
    }

    // Merge into the prior pending item (unless that prior item was just
    // confirmed and is conceptually done) so partial transcripts accumulate.
    const merged =
      previous && !previousIsComplete ? mergeItems(previous, parsed) : parsed;

    console.log('[MERGE] Incoming parsed:', {
      size: parsed.size,
      decade: parsed.decade,
      item_name: parsed.item_name,
      price: parsed.price,
    });
    console.log('[MERGE] Previous state:', {
      size: previous?.size,
      decade: previous?.decade,
      item_name: previous?.item_name,
      price: previous?.price,
    });
    console.log('[MERGE] Result after merge:', {
      size: merged.size,
      decade: merged.decade,
      item_name: merged.item_name,
      price: merged.price,
    });

    // Keep the ref in sync immediately so any follow-up calls inside the
    // same event handler (e.g. multiple items inside one final transcript)
    // see the new merged value rather than waiting for the useEffect that
    // syncs the ref from React state.
    pendingItemRef.current = merged;
    setPendingItem(merged);

    const hasEnoughFields =
      (merged.confidence.size || merged.confidence.decade) && merged.confidence.price;

    if (hasEnoughFields) {
      // Auto-confirm after delay (user can tap to confirm/edit sooner).
      // Use the merged item so we save the assembled fields, not just the
      // last fragment.
      autoConfirmTimer.current = setTimeout(() => {
        confirmItem(merged);
      }, AUTO_CONFIRM_DELAY_MS);
    }
  }

  // --- Confirm and save item ---
  async function confirmItem(item: ParsedItem) {
    if (autoConfirmTimer.current) {
      clearTimeout(autoConfirmTimer.current);
      autoConfirmTimer.current = null;
    }

    // Sanitize and validate FIRST — atomic guard against race conditions
    // (prevents double-trigger from auto-confirm + manual confirm)
    const sanitized = {
      ...item,
      size: sanitizeField(item.size),
      decade: sanitizeField(item.decade),
      item_name: sanitizeField(item.item_name),
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
      setLoggedItems((prev) => [...prev, { parsed: sanitized, id }]);
      pendingItemRef.current = null;
      setPendingItem(null);
      setLiveTranscript('');
      if (Platform.OS !== 'web') nativeRecording.clearPendingItem();
      haptic('parseSuccess');
    } catch {
      setErrorMsg('Failed to save item.');
      haptic('parseError');
    } finally {
      setSaving(false);
    }
  }

  function discardPending() {
    if (autoConfirmTimer.current) {
      clearTimeout(autoConfirmTimer.current);
      autoConfirmTimer.current = null;
    }
    pendingItemRef.current = null;
    setPendingItem(null);
    setLiveTranscript('');
    if (Platform.OS !== 'web') nativeRecording.clearPendingItem();
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
  const totalValue = loggedItems.reduce((sum, i) => sum + i.parsed.price, 0);

  // Status label is derived from the native recording phase on iOS/Android,
  // and from local listening flags on web.
  let statusLabel: string;
  if (Platform.OS === 'web') {
    statusLabel = recording
      ? pendingItem
        ? 'Item detected'
        : liveTranscript
          ? 'Hearing you…'
          : 'Listening…'
      : loggedItems.length > 0
        ? 'Session paused'
        : 'Ready';
  } else {
    switch (nativeRecording.phase) {
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
      {Platform.OS !== 'web' && nativeRecording.phase === 'transcribing' && (
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
                <Text style={styles.micIcon}>{recording ? 'Stop' : 'Start'}</Text>
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

        {Platform.OS === 'web' && !recording && loggedItems.length === 0 && (
          <Text style={styles.webNote}>Using browser speech recognition (Chrome/Edge)</Text>
        )}
      </View>

      {/* Pending item preview */}
      {pendingItem && (
        <View style={styles.previewSection}>
          <View style={styles.previewHeader}>
            <Text style={styles.previewLabel}>PREVIEW</Text>
            <View style={styles.previewHeaderRight}>
              {pendingItem.confidence.size && pendingItem.confidence.price && (
                <Text style={styles.autoConfirmHint}>Auto-confirming...</Text>
              )}
              <TouchableOpacity
                onPress={handleClear}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.clearButtonText}>Clear</Text>
              </TouchableOpacity>
            </View>
          </View>
          {pendingItem.confidence_score < 50 && (
            <View style={styles.lowConfidenceWarning}>
              <Text style={styles.warningText}>
                Some fields could not be detected. Please review and edit before confirming.
              </Text>
            </View>
          )}
          <ItemPreviewCard
            item={{
              id: '',
              ...pendingItem,
              session_id: sessionId || '',
              logged_at: new Date().toISOString(),
            }}
            editable
            onCancel={discardPending}
            rawTranscript={pendingItem.raw_transcript}
          />
          {pendingItem.confidence_score < 50 && !recording && (
            <View style={styles.retryRow}>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={async () => {
                  haptic('recordStart');
                  discardPending();
                  if (Platform.OS === 'web') {
                    startWebSpeech();
                  } else {
                    await nativeRecording.startRecording();
                  }
                }}
              >
                <Text style={styles.retryText}>Try Again</Text>
              </TouchableOpacity>
            </View>
          )}
          <View style={styles.previewActions}>
            <Button
              title="Discard"
              onPress={discardPending}
              variant="secondary"
              size="medium"
              style={styles.discardButton}
            />
            <Button
              title="Confirm Now"
              onPress={() => confirmItem(pendingItem)}
              variant="primary"
              size="medium"
              loading={saving}
              style={styles.confirmButton}
            />
          </View>
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
                <Text style={styles.feedPrice}>${item.parsed.price.toFixed(2)}</Text>
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
