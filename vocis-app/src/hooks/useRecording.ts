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
const SILENCE_DURATION_MS = 1500;
const MIN_SPEECH_DURATION_MS = 1000;
const MIN_RECORDING_SAMPLES = TARGET_SAMPLE_RATE * 0.1;

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
  const collectedSamples = useRef<Float32Array[]>([]);
  const collectedSampleCount = useRef<number>(0);
  const speechStartedAt = useRef<number | null>(null);
  const silenceStartedAt = useRef<number | null>(null);
  const autoStopFired = useRef<boolean>(false);

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
      setPartialTranscript('');
      const itemTexts = splitMultipleItems(event.text);
      const newConfirmed: ParsedItem[] = [];
      let lastIncomplete: ParsedItem | null = null;
      for (const text of itemTexts) {
        const parsed = parseTranscription(text);
        if (parsed.price !== null) newConfirmed.push(parsed);
        else lastIncomplete = parsed;
      }
      if (newConfirmed.length > 0) {
        setConfirmedItems((prev) => [...prev, ...newConfirmed]);
      }
      if (lastIncomplete) {
        setPendingItem((prev) =>
          prev ? mergeItems(prev, lastIncomplete!) : lastIncomplete
        );
      }
    }
  }, []);

  const handleStateChange = useCallback((state: ConnectionState) => {
    setConnectionState(state);
    if (state === 'connected') setPhase('listening');
  }, []);

  const handleError = useCallback((errorMsg: string) => {
    setError(errorMsg);
  }, []);

  // VAD: track speech onset → sustained silence → auto-stop.
  // stopRecording is declared after this; we read the latest ref at fire time.
  const stopRecordingRef = useRef<() => Promise<void>>(async () => {});

  const handleMetering = useCallback((db: number) => {
    setMeteringDb(db);
    if (db > SPEECH_START_THRESHOLD_DB) {
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
      if (silenceDuration > SILENCE_DURATION_MS && !autoStopFired.current) {
        autoStopFired.current = true;
        console.log('[VAD] Sustained silence — auto-stopping');
        setTimeout(() => stopRecordingRef.current(), 0);
      }
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
      collectedSamples.current = [];
      collectedSampleCount.current = 0;

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
        handleMetering(rmsToDb(pcm));
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

  const stopRecording = useCallback(async () => {
    setPhase('transcribing');
    await teardownAudioGraph();

    if (sttService.current && collectedSampleCount.current > 0) {
      try {
        const total = collectedSampleCount.current;
        const combined = new Float32Array(total);
        let offset = 0;
        for (const buf of collectedSamples.current) {
          combined.set(buf, offset);
          offset += buf.length;
        }
        const durationSecs = combined.length / TARGET_SAMPLE_RATE;
        console.log(
          '[Recording] PCM samples:',
          combined.length,
          '— duration:',
          durationSecs.toFixed(2),
          's'
        );

        if (combined.length < MIN_RECORDING_SAMPLES) {
          console.warn('[Recording] Audio too short — skipping');
          setError('Recording too short. Please speak for at least 1 second.');
        } else {
          const pcmBytes = float32ToPcm16Bytes(combined);
          const pcmBase64 = bytesToBase64(pcmBytes);
          console.log('[Recording] Sending PCM base64 length:', pcmBase64.length);
          sttService.current.sendFinalAudio(pcmBase64);
          console.log('[Recording] PCM audio sent, waiting for transcript…');
        }
      } catch (err) {
        console.error('[Recording] Failed to encode audio:', err);
        setError('Failed to process recording. Please try again.');
      }
    }

    collectedSamples.current = [];
    collectedSampleCount.current = 0;

    // Give ElevenLabs ~3s to return the final transcript before closing.
    setTimeout(() => {
      sttService.current?.disconnect();
      sttService.current = null;
    }, 3000);

    setIsRecording(false);
    setMeteringDb(-160);
    speechStartedAt.current = null;
    silenceStartedAt.current = null;
    setPhase((p) => (p === 'listening' || p === 'transcribing' ? 'idle' : p));
  }, [teardownAudioGraph]);

  useEffect(() => {
    stopRecordingRef.current = stopRecording;
  }, [stopRecording]);

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
