import { useState, useRef, useCallback, useEffect } from 'react';
import { Audio } from 'expo-av';
import { File as ExpoFile } from 'expo-file-system';
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

// Duration of each audio chunk sent to the WebSocket (ms)
const CHUNK_DURATION_MS = 1000;
// Standard WAV header size in bytes
const WAV_HEADER_BYTES = 44;

// Base64 lookup table for fast encoding
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let result = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const a = bytes[i];
    const b = i + 1 < len ? bytes[i + 1] : 0;
    const c = i + 2 < len ? bytes[i + 2] : 0;
    result += BASE64_CHARS[a >> 2];
    result += BASE64_CHARS[((a & 3) << 4) | (b >> 4)];
    result += i + 1 < len ? BASE64_CHARS[((b & 15) << 2) | (c >> 6)] : '=';
    result += i + 2 < len ? BASE64_CHARS[c & 63] : '=';
  }
  return result;
}

const RECORDING_OPTIONS: Audio.RecordingOptions = {
  isMeteringEnabled: false,
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
};

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
 * - Complete items (with size/decade + price) are auto-confirmed
 * - Incomplete items become pending for manual review
 *
 * Audio is streamed in 1-second WAV chunks — each chunk is recorded,
 * its PCM payload extracted (WAV header stripped), base64-encoded,
 * and sent to the ElevenLabs WebSocket. No audio is persisted on device.
 */
export function useRecording(): UseRecordingResult {
  const [isRecording, setIsRecording] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [partialTranscript, setPartialTranscript] = useState('');
  const [pendingItem, setPendingItem] = useState<ParsedItem | null>(null);
  const [confirmedItems, setConfirmedItems] = useState<ParsedItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const sttService = useRef<ElevenLabsSTTService | null>(null);
  const isStreamingRef = useRef(false);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isStreamingRef.current = false;
      if (sttService.current) {
        sttService.current.disconnect();
        sttService.current = null;
      }
    };
  }, []);

  const handleTranscript = useCallback((event: TranscriptEvent) => {
    try {
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
          // Auto-confirm only when we have enough fields — matches web criteria:
          // Must have (size OR decade) AND price to be considered complete
          if ((parsed.confidence.size || parsed.confidence.decade) && parsed.confidence.price) {
            newConfirmed.push(parsed);
          } else {
            // Incomplete — hold as pending for manual review
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
    } catch (err) {
      setError(`Failed to process transcript: ${(err as Error).message}`);
    }
  }, []);

  const handleStateChange = useCallback((state: ConnectionState) => {
    setConnectionState(state);
  }, []);

  const handleError = useCallback((errorMsg: string) => {
    setError(errorMsg);
  }, []);

  /**
   * Continuously records 1-second WAV chunks and streams PCM audio
   * to the ElevenLabs WebSocket. Each chunk:
   * 1. Creates a new expo-av Recording (starts capturing immediately)
   * 2. Waits CHUNK_DURATION_MS
   * 3. Stops recording, reads the WAV file
   * 4. Strips the 44-byte WAV header to get raw PCM
   * 5. Sends base64-encoded PCM via sttService.sendAudio()
   * 6. Deletes the temp file
   *
   * The small gap (~50-100ms) between chunks while reading the file
   * is acceptable — ElevenLabs buffers incoming audio server-side.
   */
  const streamAudioChunks = useCallback(async (stt: ElevenLabsSTTService) => {
    while (isStreamingRef.current) {
      let chunk: Audio.Recording | null = null;
      try {
        const result = await Audio.Recording.createAsync(RECORDING_OPTIONS);
        chunk = result.recording;

        // Record for the chunk duration
        await new Promise<void>((resolve) => setTimeout(resolve, CHUNK_DURATION_MS));

        // Stop and read the audio
        await chunk.stopAndUnloadAsync();
        const uri = chunk.getURI();
        chunk = null; // Mark as unloaded

        if (uri) {
          const file = new ExpoFile(uri);
          try {
            // Use FileHandle to skip the WAV header and read only PCM data
            const handle = file.open();
            try {
              const fileSize = handle.size ?? 0;
              if (fileSize > WAV_HEADER_BYTES && isStreamingRef.current) {
                // Seek past the 44-byte WAV header
                handle.offset = WAV_HEADER_BYTES;
                const pcmBytes = handle.readBytes(fileSize - WAV_HEADER_BYTES);
                // Convert to base64 for WebSocket transport
                const base64 = uint8ArrayToBase64(pcmBytes);
                stt.sendAudio(base64);
              }
            } finally {
              handle.close();
            }
          } finally {
            // Always clean up the temp file
            try { file.delete(); } catch {}
          }
        }
      } catch {
        // Recording may have been interrupted (e.g., user stopped, app backgrounded)
        if (chunk) {
          try { await chunk.stopAndUnloadAsync(); } catch {}
        }
        if (!isStreamingRef.current) break;
        // Brief pause before retrying to avoid tight error loops
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
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

      // Configure audio mode for recording
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

      // Connect WebSocket (includes rate limit check)
      await sttService.current.connect();

      // Start streaming audio chunks to the WebSocket
      isStreamingRef.current = true;
      setIsRecording(true);
      streamAudioChunks(sttService.current);
    } catch (err) {
      setError('Failed to start recording. Please try again.');
      setIsRecording(false);
      isStreamingRef.current = false;
    }
  }, [handleTranscript, handleStateChange, handleError, streamAudioChunks]);

  const stopRecording = useCallback(async () => {
    // Signal the streaming loop to stop
    isStreamingRef.current = false;

    if (sttService.current) {
      // Flush any buffered audio on the server to get final transcript
      sttService.current.flush();
      // Give the server a moment to send the final transcript before disconnecting
      setTimeout(() => {
        sttService.current?.disconnect();
        sttService.current = null;
      }, 500);
    }

    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
      });
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
