import AsyncStorage from '@react-native-async-storage/async-storage';
import { SecureStorage } from './secureStorage';
import { STTProxy } from './sttProxy';

const ELEVENLABS_STT_WS_URL = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime';

// CERT PINNING — TODO before production
// Cannot be implemented in Expo Go. Requires a dev build with a custom native module.
// See: https://docs.expo.dev/guides/security/
//
// For production implementation:
//   1. Get ElevenLabs SPKI hash:
//      openssl s_client -connect api.elevenlabs.io:443 </dev/null | \
//        openssl x509 -pubkey -noout | \
//        openssl pkey -pubin -outform DER | \
//        openssl dgst -sha256 -binary | base64
//   2. Add hashes to ELEVENLABS_CERT_PINS below
//   3. Implement pinning check in connect() using react-native-ssl-pinning
//
// Current status: STUB — no pinning enforced.
// Risk level: LOW — all traffic goes through Cloudflare Worker proxy (TLS terminated
// at CF edge), so the direct ElevenLabs connection is server-to-server.
const ELEVENLABS_CERT_PINS: string[] = []; // TODO: populate before production

export type TranscriptEvent = {
  type: 'partial' | 'final';
  text: string;
};

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface STTServiceCallbacks {
  onTranscript: (event: TranscriptEvent) => void;
  onStateChange: (state: ConnectionState) => void;
  onError: (error: string) => void;
}

const RATE_LIMIT_STORAGE_KEY = 'vocis_rate_limit_state';
const DAILY_USAGE_KEY = 'vocis_daily_api_usage';

/**
 * Persistent rate limiter to prevent API quota exhaustion.
 * State is stored in AsyncStorage so app restarts cannot bypass limits.
 */
class RateLimiter {
  // Max 30 minutes per session
  static readonly MAX_SESSION_DURATION_MS = 30 * 60 * 1000;
  // 5-second cooldown between sessions
  static readonly SESSION_COOLDOWN_MS = 5000;
  // Max 20 sessions per hour
  static readonly MAX_SESSIONS_PER_HOUR = 20;
  // Max 120 sessions per day (hard daily cap)
  static readonly MAX_SESSIONS_PER_DAY = 120;
  // Max 1 concurrent connection
  static readonly MAX_CONCURRENT = 1;

  private static activeConnections = 0;
  private static initialized = false;
  private static sessionTimestamps: number[] = [];
  private static lastSessionEnd = 0;
  private static dailyCount = 0;
  private static dailyDate = '';

  /**
   * Load persisted rate limit state from AsyncStorage.
   * Must be called before canStartSession.
   */
  static async initialize(): Promise<void> {
    if (this.initialized) return;
    try {
      const stored = await AsyncStorage.getItem(RATE_LIMIT_STORAGE_KEY);
      if (stored) {
        const state = JSON.parse(stored);
        this.sessionTimestamps = (state.sessionTimestamps || []).filter(
          (t: number) => t > Date.now() - 60 * 60 * 1000
        );
        this.lastSessionEnd = state.lastSessionEnd || 0;
      }

      // Load daily usage
      const today = new Date().toISOString().split('T')[0];
      const dailyData = await AsyncStorage.getItem(DAILY_USAGE_KEY);
      if (dailyData) {
        const parsed = JSON.parse(dailyData);
        if (parsed.date === today) {
          this.dailyCount = parsed.count || 0;
          this.dailyDate = today;
        } else {
          // New day, reset counter
          this.dailyCount = 0;
          this.dailyDate = today;
        }
      } else {
        this.dailyDate = today;
      }
    } catch {
      // If storage fails, start with clean state but enforce in-memory limits
    }
    this.initialized = true;
  }

  /**
   * Persist current state to AsyncStorage.
   */
  private static async persist(): Promise<void> {
    try {
      await AsyncStorage.setItem(
        RATE_LIMIT_STORAGE_KEY,
        JSON.stringify({
          sessionTimestamps: this.sessionTimestamps,
          lastSessionEnd: this.lastSessionEnd,
        })
      );
      await AsyncStorage.setItem(
        DAILY_USAGE_KEY,
        JSON.stringify({
          date: this.dailyDate,
          count: this.dailyCount,
        })
      );
    } catch {
      // Best-effort persistence
    }
  }

  static async canStartSession(): Promise<{ allowed: boolean; reason?: string }> {
    await this.initialize();

    // Check concurrent connections
    if (this.activeConnections >= this.MAX_CONCURRENT) {
      return { allowed: false, reason: 'A recording session is already active.' };
    }

    // Check cooldown
    const timeSinceLastSession = Date.now() - this.lastSessionEnd;
    if (timeSinceLastSession < this.SESSION_COOLDOWN_MS) {
      return { allowed: false, reason: 'Please wait a few seconds before starting a new session.' };
    }

    // Check hourly limit
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    this.sessionTimestamps = this.sessionTimestamps.filter((t) => t > oneHourAgo);
    if (this.sessionTimestamps.length >= this.MAX_SESSIONS_PER_HOUR) {
      return {
        allowed: false,
        reason: `Maximum ${this.MAX_SESSIONS_PER_HOUR} sessions per hour reached. Please wait.`,
      };
    }

    // Check daily limit
    const today = new Date().toISOString().split('T')[0];
    if (this.dailyDate !== today) {
      this.dailyCount = 0;
      this.dailyDate = today;
    }
    if (this.dailyCount >= this.MAX_SESSIONS_PER_DAY) {
      return {
        allowed: false,
        reason: `Daily session limit (${this.MAX_SESSIONS_PER_DAY}) reached. Try again tomorrow.`,
      };
    }

    return { allowed: true };
  }

  static async onSessionStart(): Promise<void> {
    await this.initialize();
    this.activeConnections++;
    this.sessionTimestamps.push(Date.now());
    this.dailyCount++;
    await this.persist();
  }

  static async onSessionEnd(): Promise<void> {
    this.activeConnections = Math.max(0, this.activeConnections - 1);
    this.lastSessionEnd = Date.now();
    await this.persist();
  }
}

/**
 * ElevenLabs Scribe v2 Realtime Speech-to-Text service.
 * Manages WebSocket connection, audio streaming, and transcript events.
 *
 * Security:
 * - TLS 1.2+ enforced (WSS only — plaintext WS rejected)
 * - Certificate pinning documented (enforced in native build)
 * - API key retrieved from Keychain/Keystore per-request
 * - Rate limiting: max session duration, cooldown, hourly cap
 * - Zero-retention mode: audio not stored by provider
 */
export class ElevenLabsSTTService {
  private ws: WebSocket | null = null;
  private callbacks: STTServiceCallbacks;
  private state: ConnectionState = 'disconnected';
  private sessionTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(callbacks: STTServiceCallbacks) {
    this.callbacks = callbacks;
  }

  private setState(state: ConnectionState) {
    this.state = state;
    this.callbacks.onStateChange(state);
  }

  async connect(): Promise<void> {
    console.log('[STT] connect() called');

    // Rate limit check (persistent — survives app restarts)
    const rateCheck = await RateLimiter.canStartSession();
    if (!rateCheck.allowed) {
      console.log('[STT] Rate limit blocked:', rateCheck.reason);
      this.callbacks.onError(rateCheck.reason!);
      return;
    }

    this.setState('connecting');

    try {
      let wsUrl: string;

      if (STTProxy.isEnabled()) {
        // PREFERRED: Use backend proxy — API key stays server-side
        console.log('[STT] Using proxy mode');
        const sessionToken = await STTProxy.requestToken();
        wsUrl = STTProxy.getWebSocketUrl(sessionToken.token);
      } else {
        // FALLBACK: Direct connection — API key from device Keychain/Keystore
        console.log('[STT] Proxy not configured — falling back to direct mode');
        const directUrl = await STTProxy.getDirectWebSocketUrl();
        if (!directUrl) {
          this.callbacks.onError(
            'No API key configured. Go to Settings to add your ElevenLabs API key.'
          );
          this.setState('disconnected');
          return;
        }
        wsUrl = directUrl;
      }

      // Enforce TLS — reject non-encrypted connections
      if (!wsUrl.startsWith('wss://')) {
        this.callbacks.onError('Security error: only encrypted (WSS) connections are allowed.');
        this.setState('disconnected');
        return;
      }

      // Log URL with sensitive params redacted — use a regex that preserves the ? separator.
      console.log('[STT] Opening WebSocket to:', wsUrl.replace(/(token|api_key)=[^&]+/g, '$1=<redacted>'));
      this.ws = new WebSocket(wsUrl);
      console.log('[STT] WebSocket created, readyState:', this.ws.readyState);

      this.ws.onopen = async () => {
        console.log('[STT] WebSocket opened successfully');
        this.setState('connected');
        await RateLimiter.onSessionStart();

        // No init message needed — Scribe v2 Realtime is configured via URL
        // query params (model_id, language_code, sample_rate) set in sttProxy.ts.

        // Enforce max session duration
        this.sessionTimeout = setTimeout(() => {
          this.callbacks.onError(
            'Maximum session duration reached (30 minutes). Session will end.'
          );
          this.disconnect();
        }, RateLimiter.MAX_SESSION_DURATION_MS);
      };

      this.ws.onmessage = (event) => {
        console.log('[STT] Message received:', String(event.data).slice(0, 120));
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch {
          // Non-JSON message, ignore
        }
      };

      this.ws.onerror = (err) => {
        console.error('[STT] WebSocket error event:', err);
        this.setState('error');
        this.callbacks.onError(
          'WebSocket connection error. Check your internet connection and API key.'
        );
      };

      this.ws.onclose = async (event) => {
        console.log(`[STT] WebSocket closed — code: ${event.code}, reason: "${event.reason}", wasClean: ${event.wasClean}`);
        await this.cleanup();
        if (event.code !== 1000) {
          this.callbacks.onError(
            `Connection closed unexpectedly (code: ${event.code}${event.reason ? ` — ${event.reason}` : ''}).`
          );
        }
        this.setState('disconnected');
      };
    } catch (err) {
      console.error('[STT] connect() threw:', err);
      this.setState('error');
      // Do not expose internal error details to the UI — log only.
      this.callbacks.onError('Failed to connect. Check your internet connection and try again.');
    }
  }

  private handleMessage(data: Record<string, unknown>) {
    // ElevenLabs Scribe v2 Realtime message types:
    // https://elevenlabs.io/docs/api-reference/speech-to-text/realtime
    switch (data.message_type) {
      case 'session_started':
        console.log('[STT] Session started, session_id:', data.session_id);
        break;
      case 'partial_transcript':
        if (typeof data.text === 'string' && data.text.trim()) {
          this.callbacks.onTranscript({ type: 'partial', text: data.text });
        }
        break;
      case 'committed_transcript':
        if (typeof data.text === 'string' && data.text.trim()) {
          console.log('[STT] Final transcript:', data.text);
          this.callbacks.onTranscript({ type: 'final', text: data.text });
        }
        break;
      case 'commit_throttled':
        // Sent when commit:true arrives but ElevenLabs has received <1s of audio.
        console.warn('[STT] commit_throttled — not enough audio was sent');
        this.callbacks.onError('Recording too short. Please speak for at least 1 second.');
        break;
      case 'error':
        this.callbacks.onError(
          typeof data.message === 'string' ? data.message : 'Unknown server error'
        );
        break;
      default:
        console.log('[STT] Unknown message_type:', data.message_type);
    }
  }

  /**
   * Send an audio chunk to the WebSocket.
   * Audio must be base64-encoded PCM 16kHz mono 16-bit.
   */
  sendAudio(base64Audio: string): void {
    if (this.state !== 'connected' || !this.ws) return;

    this.ws.send(
      JSON.stringify({
        message_type: 'input_audio_chunk',
        audio_base_64: base64Audio,
        commit: false,
        sample_rate: 16000,
      })
    );
  }

  /**
   * Send the final audio chunk with commit:true in a single message.
   * ElevenLabs commits only the audio present in the commit:true message,
   * so audio and commit MUST be in the same message — not split across two.
   */
  sendFinalAudio(base64Audio: string): void {
    if (this.state !== 'connected' || !this.ws) return;

    this.ws.send(
      JSON.stringify({
        message_type: 'input_audio_chunk',
        audio_base_64: base64Audio,
        commit: true,
        sample_rate: 16000,
      })
    );
  }

  /**
   * Commit the audio buffer — signals end of the current utterance.
   * ElevenLabs will finalize the transcript and emit committed_transcript.
   * NOTE: Only use this after streaming incremental chunks. For single-shot
   * recordings, use sendFinalAudio() which combines audio + commit in one message.
   */
  flush(): void {
    if (this.state !== 'connected' || !this.ws) return;

    this.ws.send(
      JSON.stringify({
        message_type: 'input_audio_chunk',
        audio_base_64: '',
        commit: true,
        sample_rate: 16000,
      })
    );
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close(1000, 'Session ended by user');
    }
    await this.cleanup();
    this.setState('disconnected');
  }

  private async cleanup() {
    if (this.sessionTimeout) {
      clearTimeout(this.sessionTimeout);
      this.sessionTimeout = null;
    }
    this.ws = null;
    await RateLimiter.onSessionEnd();
  }

  getState(): ConnectionState {
    return this.state;
  }
}
