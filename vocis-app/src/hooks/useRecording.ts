import { useState, useRef, useCallback, useEffect } from 'react';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import {
  ElevenLabsSTTService,
  ConnectionState,
  TranscriptEvent,
} from '../services/elevenLabsSTT';
import {
  parseTranscription,
  splitMultipleItems,
  ParsedItem,
} from '../services/voiceParser';

export interface UseRecordingResult {
  isRecording: boolean;
  connectionState: ConnectionState;
  partialTranscript: string;
  /** The current pending item (shown as preview, not yet confirmed) */
  pendingItem: ParsedItem | null;
  /** Items auto-confirmed from continuous speech — consume these in the UI */
  confirmedItems: ParsedItem[];
  error: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  clearPendingItem: () => void;
  consumeConfirmedItems: () => void;
  clearError: () => void;
}

/**
 * Hook that manages the full native recording pipeline:
 * Microphone → Audio chunks → WebSocket → Transcript → Parser
 *
 * Supports continuous rapid-fire mode:
 * - Partial transcripts update live for visual feedback
 * - Final transcripts are split into multiple items if detected
 * - Complete items (with price) are auto-confirmed
 * - Incomplete items become pending for manual review
 *
 * No audio is ever written to device storage.
 */
export function useRecording(): UseRecordingResult {
  const [isRecording, setIsRecording] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [partialTranscript, setPartialTranscript] = useState('');
  const [pendingItem, setPendingItem] = useState<ParsedItem | null>(null);
  const [confirmedItems, setConfirmedItems] = useState<ParsedItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const sttService = useRef<ElevenLabsSTTService | null>(null);
  const recording = useRef<Audio.Recording | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, []);

  const handleTranscript = useCallback((event: TranscriptEvent) => {
    if (event.type === 'partial') {
      setPartialTranscript(event.text);

      // Show real-time preview of what's being parsed (visual only)
      const items = splitMultipleItems(event.text);
      const current = items[items.length - 1];
      if (current) {
        const parsed = parseTranscription(current);
        if (parsed.confidence.size || parsed.confidence.decade) {
          setPendingItem(parsed);
        }
      }
    } else if (event.type === 'final') {
      setPartialTranscript('');

      // Split transcript into individual items
      const itemTexts = splitMultipleItems(event.text);
      const newConfirmed: ParsedItem[] = [];
      let lastIncomplete: ParsedItem | null = null;

      for (const text of itemTexts) {
        const parsed = parseTranscription(text);
        if (parsed.confidence.price) {
          // Complete item — auto-confirm
          newConfirmed.push(parsed);
        } else {
          // Incomplete — hold as pending
          lastIncomplete = parsed;
        }
      }

      // Batch-add confirmed items
      if (newConfirmed.length > 0) {
        setConfirmedItems((prev) => [...prev, ...newConfirmed]);
      }

      // Set pending to the last incomplete item (or null if all complete)
      setPendingItem(lastIncomplete);
    }
  }, []);

  const handleStateChange = useCallback((state: ConnectionState) => {
    setConnectionState(state);
  }, []);

  const handleError = useCallback((errorMsg: string) => {
    setError(errorMsg);
  }, []);

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setPartialTranscript('');
      setPendingItem(null);
      setConfirmedItems([]);

      // Request microphone permission
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        setError('Microphone permission is required to record inventory items.');
        return;
      }

      // Configure audio mode
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      // Initialize STT service
      sttService.current = new ElevenLabsSTTService({
        onTranscript: handleTranscript,
        onStateChange: handleStateChange,
        onError: handleError,
      });

      // Connect WebSocket
      await sttService.current.connect();

      // Start recording with PCM format for streaming
      const { recording: newRecording } = await Audio.Recording.createAsync({
        isMeteringEnabled: true,
        android: {
          extension: '.wav',
          outputFormat: Audio.AndroidOutputFormat.DEFAULT,
          audioEncoder: Audio.AndroidAudioEncoder.DEFAULT,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 256000,
        },
        ios: {
          extension: '.wav',
          outputFormat: Audio.IOSOutputFormat.LINEARPCM,
          audioQuality: Audio.IOSAudioQuality.HIGH,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 256000,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
        web: {
          mimeType: 'audio/webm',
          bitsPerSecond: 128000,
        },
      });

      recording.current = newRecording;
      setIsRecording(true);
      // Audio is read and sent in stopRecording() after the recording file is complete.
      // On iOS/Expo Go the recording file does not grow on disk during active recording
      // (the OS buffers audio internally), so streaming from the file mid-recording
      // yields empty reads. Reading the complete file after stop is the reliable approach.
    } catch (err) {
      setError('Failed to start recording. Please try again.');
      setIsRecording(false);
    }
  }, [handleTranscript, handleStateChange, handleError]);

  const stopRecording = useCallback(async () => {
    // Capture the URI before stopping — expo-av clears it after unload.
    const audioUri = recording.current?.getURI() ?? null;

    if (recording.current) {
      try {
        await recording.current.stopAndUnloadAsync();
      } catch {
        // Already stopped
      }
      recording.current = null;
    }

    if (sttService.current) {
      if (audioUri) {
        try {
          // Read the complete WAV file as base64.
          // Do NOT use the `position` option — it is unreliable in expo-file-system/legacy
          // and causes the WAV header to leak into the audio data sent to ElevenLabs.
          const base64Wav = await FileSystem.readAsStringAsync(
            audioUri,
            { encoding: FileSystem.EncodingType.Base64 }
          );

          // Decode base64 → raw bytes so we can inspect and strip the WAV header.
          const binaryStr = atob(base64Wav);
          const wavBytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            wavBytes[i] = binaryStr.charCodeAt(i);
          }

          // Verify the file is a valid WAV (RIFF magic bytes at offset 0).
          const header = String.fromCharCode(wavBytes[0], wavBytes[1], wavBytes[2], wavBytes[3]);
          console.log('[Recording] File header:', header, '— total bytes:', wavBytes.length);

          // Strip the 44-byte WAV header — ElevenLabs requires raw PCM only.
          const WAV_HEADER_SIZE = 44;
          const pcmBytes = wavBytes.slice(WAV_HEADER_SIZE);

          // 16kHz mono 16-bit PCM: 1 second = 16000 samples × 2 bytes = 32000 bytes.
          const durationSecs = pcmBytes.length / (16000 * 2);
          console.log('[Recording] PCM bytes:', pcmBytes.length);
          console.log('[Recording] Audio duration:', durationSecs.toFixed(2), 'seconds');

          if (pcmBytes.length < 3200) { // < 0.1 seconds
            console.warn('[Recording] Audio too short — skipping');
            setError('Recording too short. Please speak for at least 1 second.');
          } else {
            // Re-encode PCM bytes → base64 in chunks to avoid call-stack overflow
            // on large recordings (String.fromCharCode spread crashes above ~100k bytes).
            const bytesToBase64 = (bytes: Uint8Array): string => {
              let binary = '';
              const chunkSize = 8192;
              for (let i = 0; i < bytes.length; i += chunkSize) {
                const chunk = bytes.slice(i, i + chunkSize);
                chunk.forEach((b) => { binary += String.fromCharCode(b); });
              }
              return btoa(binary);
            };

            const pcmBase64 = bytesToBase64(pcmBytes);
            console.log('[Recording] Sending PCM base64 length:', pcmBase64.length);
            // Send audio + commit in ONE message — ElevenLabs commits only the audio
            // present in the commit:true message. Splitting into sendAudio + flush
            // results in committing an empty buffer (0.00s audio).
            sttService.current.sendFinalAudio(pcmBase64);
            console.log('[Recording] PCM audio sent with commit:true, waiting for transcript...');
          }
        } catch (err) {
          console.error('[Recording] Failed to read audio file:', err);
          setError('Failed to process recording. Please try again.');
        } finally {
          // Delete the temp WAV file immediately after reading — audio must not
          // persist on device storage beyond the recording session.
          try {
            await FileSystem.deleteAsync(audioUri, { idempotent: true });
            console.log('[Recording] Temp audio file deleted');
          } catch {
            // Best-effort — OS will clean up temp files eventually
          }
        }
      }

      // Give ElevenLabs time to process the audio and return the transcript.
      setTimeout(() => {
        sttService.current?.disconnect();
        sttService.current = null;
      }, 3000);
    }

    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
    } catch {
      // Ignore cleanup errors
    }

    setIsRecording(false);
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
    connectionState,
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
