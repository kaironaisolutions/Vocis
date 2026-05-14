import { useState, useRef, useCallback, useEffect } from 'react';
import {
  ElevenLabsSTTService,
  ConnectionState,
  TranscriptEvent,
} from '../services/elevenLabsSTT';
import {
  parseTranscription,
  splitMultipleItems,
  mergeItems,
  ParsedItem,
} from '../services/voiceParser';
import { KeytermsService } from '../services/keyterms';

export type RecordingPhase =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'transcribing'
  | 'error';

export interface UseRecordingResult {
  isRecording: boolean;
  phase: RecordingPhase;
  connectionState: ConnectionState;
  meteringDb: number;
  partialTranscript: string;
  pendingItem: ParsedItem | null;
  confirmedItems: ParsedItem[];
  error: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  clearPendingItem: () => void;
  consumeConfirmedItems: () => void;
  clearError: () => void;
}

const TARGET_SAMPLE_RATE = 16000;
const SILENCE_THRESHOLD_DB = -40;
const SPEECH_START_THRESHOLD_DB = -25;
// Per-item commit threshold: 2.5 seconds of silence after speech triggers
// commit:true (saves the current utterance) but does NOT tear down the
// recording session. The audio context and WebSocket stay alive so the
// user can keep speaking — pick up next garment, talk, pause, repeat.
//
// Why 2.5s and not the earlier 8s: 8s was the spec value but every item
// auto-saved 8+ seconds after the user finished speaking it, which felt
// broken. 2.5s gives natural-pause headroom (longer than a normal
// inter-word gap) while keeping per-item feedback snappy.
const COMMIT_SILENCE_MS = 2500;
// Safety net: if no audio activity (no speech detected at all) for 30
// seconds, auto-end the session to free server resources. User can
// always tap Start again. End Session button overrides this.
const AUTO_STOP_SILENCE_MS = 30000;
const MIN_SPEECH_DURATION_MS = 1000;
const MIN_RECORDING_SAMPLES = TARGET_SAMPLE_RATE * 0.1;
// 200ms chunks — small enough to keep partial transcripts feeling live,
// large enough to avoid spamming the WebSocket (~5 sends/second).
const STREAMING_CHUNK_SAMPLES = TARGET_SAMPLE_RATE * 0.2;

// Inline AudioWorklet that ships each 128-sample Float32 block from the mic
// back to the main thread. Loaded via Blob URL so no separate file / bundler
// configuration is needed.
const PCM_WORKLET_SOURCE = `
class PCMCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0] && input[0].length > 0) {
      // slice(0) copies the buffer — the worklet reuses the same array
      // each tick, so without a copy the main thread sees zeros.
      this.port.postMessage(input[0].slice(0));
    }
    return true;
  }
}
registerProcessor('pcm-capture', PCMCaptureProcessor);
`;

function float32ToPcm16Bytes(float32: Float32Array): Uint8Array {
  const bytes = new Uint8Array(float32.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < float32.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32[i]));
    const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(i * 2, int16, true);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    for (let j = 0; j < chunk.length; j++) {
      binary += String.fromCharCode(chunk[j]);
    }
  }
  return btoa(binary);
}

function rmsToDb(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / samples.length);
  return rms > 0 ? 20 * Math.log10(rms) : -160;
}

/**
 * Web recording pipeline:
 *   getUserMedia → AudioContext(16 kHz) → AudioWorklet → Float32 PCM
 *   → on stop: concat → Int16 PCM → base64 → ElevenLabsSTTService.sendFinalAudio
 *
 * Mirrors the contract of the prior native (expo-av) hook so the call site
 * in record.tsx can stay unchanged.
 */
export function useRecording(): UseRecordingResult {
  const [isRecording, setIsRecording] = useState(false);
  const [phase, setPhase] = useState<RecordingPhase>('idle');
  const [connectionState, setConnectionState] =
    useState<ConnectionState>('disconnected');
  const [meteringDb, setMeteringDb] = useState<number>(-160);
  const [partialTranscript, setPartialTranscript] = useState('');
  const [pendingItem, setPendingItem] = useState<ParsedItem | null>(null);
  const [confirmedItems, setConfirmedItems] = useState<ParsedItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const sttService = useRef<ElevenLabsSTTService | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const mediaStream = useRef<MediaStream | null>(null);
  const workletNode = useRef<AudioWorkletNode | null>(null);
  const sourceNode = useRef<MediaStreamAudioSourceNode | null>(null);
  const muteGain = useRef<GainNode | null>(null);
  // Full-session buffer — sent in one shot on stop via sendFinalAudio so
  // ElevenLabs commits the entire utterance. (Per the STT service comments,
  // commit:true must carry the audio; chunks streamed with commit:false do
  // not survive into the final commit.)
  const collectedSamples = useRef<Float32Array[]>([]);
  const collectedSampleCount = useRef<number>(0);
  // Streaming buffer — drained every ~200ms via sendAudio (commit:false) to
  // trigger partial_transcript events for live UI feedback. Parallel to the
  // full-session buffer; sample data ends up in both.
  const unsentSamples = useRef<Float32Array[]>([]);
  const unsentSampleCount = useRef<number>(0);
  const speechStartedAt = useRef<number | null>(null);
  const silenceStartedAt = useRef<number | null>(null);
  const autoStopFired = useRef<boolean>(false);
  // Wall-clock timestamp of the last time audio crossed the speech-start
  // threshold. Drives the 30s "no activity at all" auto-end safety net.
  // Initialized in startRecording so the user gets a grace period before
  // the timer starts ticking.
  const lastSpeechAt = useRef<number>(0);

  const handleTranscript = useCallback((event: TranscriptEvent) => {
    if (event.type === 'partial') {
      setPartialTranscript(event.text);
      const items = splitMultipleItems(event.text);
      const current = items[items.length - 1];
      if (current) {
        const parsed = parseTranscription(current);
        if (parsed.size !== null || parsed.decade !== null) {
          setPendingItem((prev) => (prev ? mergeItems(prev, parsed) : parsed));
        }
      }
    } else if (event.type === 'final') {
      console.log('[SESSION] handleTranscript: final received:', JSON.stringify(event.text));
      setPartialTranscript('');
      // Auto-save flow: every committed transcript with an item_name goes
      // straight into confirmedItems. record.tsx auto-saves them via DB,
      // shows the saved-flash, and clears pendingItem. Items without an
      // item_name (fragments, noise) are dropped here — validateItem in
      // record.tsx would reject them anyway.
      const itemTexts = splitMultipleItems(event.text);
      const newConfirmed: ParsedItem[] = [];
      for (const text of itemTexts) {
        const parsed = parseTranscription(text);
        if (parsed.item_name !== null) newConfirmed.push(parsed);
      }
      console.log(
        '[SESSION] handleTranscript: parsed',
        itemTexts.length,
        'segments,',
        newConfirmed.length,
        'have item_name and will auto-save'
      );
      if (newConfirmed.length > 0) {
        setConfirmedItems((prev) => [...prev, ...newConfirmed]);
      }
      // Clear the live-preview pending item so the UI resets between
      // utterances. The save handler in record.tsx also does this; this
      // is the hook-side mirror.
      setPendingItem(null);
    }
  }, []);

  const handleStateChange = useCallback((state: ConnectionState) => {
    setConnectionState(state);
    if (state === 'connected') setPhase('listening');
  }, []);

  const handleError = useCallback((errorMsg: string) => {
    setError(errorMsg);
  }, []);

  // VAD: track speech onset → sustained silence → COMMIT (not stop).
  // commitUtteranceRef is read at fire-time so we always get the current
  // closure (function is declared further down).
  const commitUtteranceRef = useRef<() => void>(() => {});
  const stopRecordingRef = useRef<() => Promise<void>>(async () => {});

  const handleMetering = useCallback((db: number) => {
    setMeteringDb(db);
    if (db > SPEECH_START_THRESHOLD_DB) {
      lastSpeechAt.current = Date.now();
      if (speechStartedAt.current === null) speechStartedAt.current = Date.now();
      silenceStartedAt.current = null;
      return;
    }
    if (db < SILENCE_THRESHOLD_DB && speechStartedAt.current !== null) {
      const speechDuration = Date.now() - speechStartedAt.current;
      if (speechDuration < MIN_SPEECH_DURATION_MS) return;
      if (silenceStartedAt.current === null) {
        silenceStartedAt.current = Date.now();
        return;
      }
      const silenceDuration = Date.now() - silenceStartedAt.current;
      if (silenceDuration > COMMIT_SILENCE_MS && !autoStopFired.current) {
        autoStopFired.current = true;
        console.log(
          `[SESSION] VAD: ${COMMIT_SILENCE_MS}ms sustained silence — firing commitUtterance`
        );
        setTimeout(() => commitUtteranceRef.current(), 0);
      }
    }
    // Inactivity safety net: if 30 seconds have passed without ANY speech
    // (the user wandered off, forgot to tap End Session, etc.), tear down
    // so we're not holding the WebSocket open burning CF resources.
    if (
      lastSpeechAt.current > 0 &&
      Date.now() - lastSpeechAt.current > AUTO_STOP_SILENCE_MS
    ) {
      console.log(
        `[SESSION] VAD: ${AUTO_STOP_SILENCE_MS}ms inactivity — auto-ending session`
      );
      lastSpeechAt.current = 0;
      setTimeout(() => stopRecordingRef.current(), 0);
    }
  }, []);

  const teardownAudioGraph = useCallback(async () => {
    if (workletNode.current) {
      workletNode.current.port.onmessage = null;
      try {
        workletNode.current.disconnect();
      } catch {}
      workletNode.current = null;
    }
    if (sourceNode.current) {
      try {
        sourceNode.current.disconnect();
      } catch {}
      sourceNode.current = null;
    }
    if (muteGain.current) {
      try {
        muteGain.current.disconnect();
      } catch {}
      muteGain.current = null;
    }
    if (audioContext.current) {
      try {
        await audioContext.current.close();
      } catch {}
      audioContext.current = null;
    }
    if (mediaStream.current) {
      mediaStream.current.getTracks().forEach((t) => t.stop());
      mediaStream.current = null;
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setPartialTranscript('');
      setPendingItem(null);
      setConfirmedItems([]);
      setPhase('connecting');
      speechStartedAt.current = null;
      silenceStartedAt.current = null;
      autoStopFired.current = false;
      // Grace period for the user to actually start speaking before the
      // 30s inactivity auto-stop kicks in. Reset to Date.now() so the
      // first 30s after Start are tolerated even if completely silent.
      lastSpeechAt.current = Date.now();
      collectedSamples.current = [];
      collectedSampleCount.current = 0;
      unsentSamples.current = [];
      unsentSampleCount.current = 0;

      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setError(
          'Microphone capture requires a modern browser (Chrome 95+, Edge 95+, Safari 14.1+).'
        );
        setPhase('error');
        return;
      }
      if (typeof window === 'undefined' || typeof (window as unknown as { AudioContext?: unknown }).AudioContext === 'undefined') {
        setError('AudioContext is not available in this browser.');
        setPhase('error');
        return;
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch (err) {
        console.error('[Recording] getUserMedia failed:', err);
        setError(
          'Microphone permission denied. Allow mic access in your browser settings.'
        );
        setPhase('error');
        return;
      }
      mediaStream.current = stream;

      const ctx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
      audioContext.current = ctx;

      const workletBlob = new Blob([PCM_WORKLET_SOURCE], {
        type: 'application/javascript',
      });
      const workletUrl = URL.createObjectURL(workletBlob);
      try {
        await ctx.audioWorklet.addModule(workletUrl);
      } finally {
        URL.revokeObjectURL(workletUrl);
      }

      const source = ctx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(ctx, 'pcm-capture');
      const gain = ctx.createGain();
      gain.gain.value = 0;

      worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
        const pcm = event.data;
        collectedSamples.current.push(pcm);
        collectedSampleCount.current += pcm.length;
        unsentSamples.current.push(pcm);
        unsentSampleCount.current += pcm.length;
        handleMetering(rmsToDb(pcm));

        // Drain the streaming buffer once we have ~200ms of audio; sending
        // smaller chunks at higher cadence makes partial transcripts feel
        // responsive without saturating the WebSocket.
        if (
          unsentSampleCount.current >= STREAMING_CHUNK_SAMPLES &&
          sttService.current
        ) {
          const chunks = unsentSamples.current;
          const total = unsentSampleCount.current;
          unsentSamples.current = [];
          unsentSampleCount.current = 0;
          const combined = new Float32Array(total);
          let offset = 0;
          for (const buf of chunks) {
            combined.set(buf, offset);
            offset += buf.length;
          }
          const pcmBase64 = bytesToBase64(float32ToPcm16Bytes(combined));
          sttService.current.sendAudio(pcmBase64);
        }
      };

      // Routing: mic → worklet → muted gain → destination.
      // process() only fires when the node is in an active audio graph; the
      // muted gain stage keeps the graph live without playback to speakers.
      source.connect(worklet);
      worklet.connect(gain);
      gain.connect(ctx.destination);

      sourceNode.current = source;
      workletNode.current = worklet;
      muteGain.current = gain;

      const keyterms = await KeytermsService.getAll().catch(() => []);
      sttService.current = new ElevenLabsSTTService({
        onTranscript: handleTranscript,
        onStateChange: handleStateChange,
        onError: handleError,
      });
      sttService.current.setKeyterms(keyterms);
      await sttService.current.connect();

      setIsRecording(true);
      // phase moves to 'listening' on connectionState === 'connected'.
    } catch (err) {
      console.error('[Recording] start failed:', err);
      await teardownAudioGraph();
      setError('Failed to start recording. Please try again.');
      setIsRecording(false);
      setPhase('error');
    }
  }, [
    handleTranscript,
    handleStateChange,
    handleError,
    handleMetering,
    teardownAudioGraph,
  ]);

  /**
   * Commit the current utterance and KEEP recording. Called from VAD when
   * sustained silence is detected after speech. Sends commit:true to
   * ElevenLabs (which will emit a committed_transcript), then resets the
   * VAD state so the next utterance is detected from scratch. The audio
   * context, mic stream, and WebSocket stay alive.
   */
  const commitUtterance = useCallback(() => {
    if (!sttService.current) return;
    if (collectedSampleCount.current < MIN_RECORDING_SAMPLES) {
      // Not enough audio to commit — likely a false-positive VAD trigger
      // (background cough, brief noise). Reset and keep listening.
      speechStartedAt.current = null;
      silenceStartedAt.current = null;
      autoStopFired.current = false;
      return;
    }
    try {
      if (unsentSampleCount.current > 0) {
        const leftover = new Float32Array(unsentSampleCount.current);
        let offset = 0;
        for (const buf of unsentSamples.current) {
          leftover.set(buf, offset);
          offset += buf.length;
        }
        const pcmBase64 = bytesToBase64(float32ToPcm16Bytes(leftover));
        console.log(
          '[SESSION] commitUtterance: sending leftover+commit:true, base64 length',
          pcmBase64.length,
          '— awaiting committed_transcript'
        );
        sttService.current.sendFinalAudio(pcmBase64);
      } else {
        console.log(
          '[SESSION] commitUtterance: empty leftover, flushing commit:true — awaiting committed_transcript'
        );
        sttService.current.flush();
      }
    } catch (err) {
      console.error('[SESSION] commitUtterance failed:', err);
    }
    // Reset per-utterance buffers and VAD state. The audio worklet keeps
    // running and will populate these again as the user speaks the next item.
    unsentSamples.current = [];
    unsentSampleCount.current = 0;
    collectedSamples.current = [];
    collectedSampleCount.current = 0;
    speechStartedAt.current = null;
    silenceStartedAt.current = null;
    autoStopFired.current = false;
  }, []);

  const stopRecording = useCallback(async () => {
    setPhase('transcribing');
    await teardownAudioGraph();

    if (sttService.current && collectedSampleCount.current > 0) {
      try {
        const durationSecs = collectedSampleCount.current / TARGET_SAMPLE_RATE;
        console.log(
          '[Recording] Total PCM samples:',
          collectedSampleCount.current,
          '— duration:',
          durationSecs.toFixed(2),
          's',
          '— leftover (unsent) samples:',
          unsentSampleCount.current
        );

        if (collectedSampleCount.current < MIN_RECORDING_SAMPLES) {
          console.warn('[Recording] Audio too short — skipping');
          setError('Recording too short. Please speak for at least 1 second.');
        } else {
          // Send ONLY the leftover chunk (samples accumulated since the last
          // streaming drain) with commit:true. ElevenLabs accumulates the
          // streamed chunks server-side; sending the full session here too
          // would double-feed the audio and produce a duplicated transcript
          // ("X. X."). The commit:true on this final chunk tells the server
          // to finalize the accumulated buffer.
          if (unsentSampleCount.current > 0) {
            const leftover = new Float32Array(unsentSampleCount.current);
            let offset = 0;
            for (const buf of unsentSamples.current) {
              leftover.set(buf, offset);
              offset += buf.length;
            }
            const pcmBase64 = bytesToBase64(float32ToPcm16Bytes(leftover));
            console.log(
              '[Recording] Sending final leftover chunk, base64 length:',
              pcmBase64.length
            );
            sttService.current.sendFinalAudio(pcmBase64);
          } else {
            // Nothing left to send — commit with empty audio to finalize
            // the already-streamed buffer.
            console.log('[Recording] No leftover — flushing empty commit');
            sttService.current.flush();
          }
          console.log('[Recording] Waiting for transcript…');
        }
      } catch (err) {
        console.error('[Recording] Failed to encode audio:', err);
        setError('Failed to process recording. Please try again.');
      }
    }

    collectedSamples.current = [];
    collectedSampleCount.current = 0;
    unsentSamples.current = [];
    unsentSampleCount.current = 0;

    // Give ElevenLabs ~3s to return the final transcript before closing.
    setTimeout(() => {
      sttService.current?.disconnect();
      sttService.current = null;
    }, 3000);

    setIsRecording(false);
    setMeteringDb(-160);
    speechStartedAt.current = null;
    silenceStartedAt.current = null;
    lastSpeechAt.current = 0;
    setPhase((p) => (p === 'listening' || p === 'transcribing' ? 'idle' : p));
  }, [teardownAudioGraph]);

  useEffect(() => {
    stopRecordingRef.current = stopRecording;
    commitUtteranceRef.current = commitUtterance;
  }, [stopRecording, commitUtterance]);

  useEffect(() => {
    return () => {
      stopRecording();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearPendingItem = useCallback(() => {
    setPendingItem(null);
    setPartialTranscript('');
  }, []);

  const consumeConfirmedItems = useCallback(() => {
    setConfirmedItems([]);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    isRecording,
    phase,
    connectionState,
    meteringDb,
    partialTranscript,
    pendingItem,
    confirmedItems,
    error,
    startRecording,
    stopRecording,
    clearPendingItem,
    consumeConfirmedItems,
    clearError,
  };
}
