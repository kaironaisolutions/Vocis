import AsyncStorage from '@react-native-async-storage/async-storage';
import { SecureStorage } from './secureStorage';
import { STTProxy } from './sttProxy';

const ELEVENLABS_STT_WS_URL = 'wss://api.elevenlabs.io/v1/speech-to-text/stream';

// Certificate pinning: SHA-256 pins for ElevenLabs API endpoint.
// These should be updated when ElevenLabs rotates their certificates.
// In a native build, actual pinning is enforced via react-native-ssl-pinning
// or a custom native module. This constant documents the expected pins.
const ELEVENLABS_CERT_PINS = [
  // Primary pin (current certificate)
  // Secondary pin (backup certificate)
  // These values must be obtained from ElevenLabs and updated periodically.
  // Placeholder — replace with actual SHA-256 SPKI hashes before production.
] as const;

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
    // Rate limit check (persistent — survives app restarts)
    const rateCheck = await RateLimiter.canStartSession();
    if (!rateCheck.allowed) {
      this.callbacks.onError(rateCheck.reason!);
      return;
    }

    this.setState('connecting');

    try {
      let wsUrl: string;

      if (!STTProxy.isEnabled()) {
        this.callbacks.onError(
          'Speech-to-text proxy is not configured. Contact support.'
        );
        this.setState('disconnected');
        return;
      }

      // All connections go through the Cloudflare Worker proxy.
      // The API key stays server-side — never in client URLs.
      // Token is passed via Sec-WebSocket-Protocol header, not in the URL.
      const sessionToken = await STTProxy.requestToken();
      wsUrl = STTProxy.getWebSocketUrl();
      const wsProtocol = STTProxy.getWebSocketProtocol(sessionToken.token);

      // Enforce TLS — reject non-encrypted connections
      if (!wsUrl.startsWith('wss://')) {
        this.callbacks.onError('Security error: only encrypted (WSS) connections are allowed.');
        this.setState('disconnected');
        return;
      }

      this.ws = new WebSocket(wsUrl, wsProtocol);

      this.ws.onopen = async () => {
        this.setState('connected');
        await RateLimiter.onSessionStart();

        // Send initial configuration
        this.ws?.send(
          JSON.stringify({
            type: 'config',
            config: {
              language: 'en',
              encoding: 'pcm_16000',
              sample_rate: 16000,
            },
          })
        );

        // Enforce max session duration
        this.sessionTimeout = setTimeout(() => {
          this.callbacks.onError(
            'Maximum session duration reached (30 minutes). Session will end.'
          );
          this.disconnect();
        }, RateLimiter.MAX_SESSION_DURATION_MS);
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch {
          // Non-JSON message, ignore
        }
      };

      this.ws.onerror = () => {
        this.setState('error');
        this.callbacks.onError(
          'Connection error. Check your internet connection and try again.'
        );
      };

      this.ws.onclose = async (event) => {
        await this.cleanup();
        if (event.code !== 1000) {
          this.callbacks.onError(
            `Connection closed unexpectedly (code: ${event.code}).`
          );
        }
        this.setState('disconnected');
      };
    } catch {
      this.setState('error');
      this.callbacks.onError('Failed to establish WebSocket connection.');
    }
  }

  private handleMessage(data: Record<string, unknown>) {
    switch (data.type) {
      case 'transcript':
        if (typeof data.text === 'string' && data.text.trim()) {
          this.callbacks.onTranscript({
            type: data.is_final ? 'final' : 'partial',
            text: data.text,
          });
        }
        break;
      case 'error':
        this.callbacks.onError(
          typeof data.message === 'string' ? data.message : 'Unknown server error'
        );
        break;
    }
  }

  /**
   * Send an audio chunk to the WebSocket.
   * Audio must be base64-encoded PCM 16kHz mono.
   */
  sendAudio(base64Audio: string): void {
    if (this.state !== 'connected' || !this.ws) return;

    this.ws.send(
      JSON.stringify({
        type: 'audio',
        audio: base64Audio,
      })
    );
  }

  /**
   * Signal end of speech for the current utterance.
   */
  flush(): void {
    if (this.state !== 'connected' || !this.ws) return;

    this.ws.send(JSON.stringify({ type: 'flush' }));
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
