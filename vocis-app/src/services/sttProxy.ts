import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * STT Proxy client — requests session tokens from the Cloudflare Worker
 * instead of sending the API key directly to ElevenLabs.
 *
 * The Worker holds the real ElevenLabs API key server-side.
 * The app only receives a short-lived, single-use session token.
 */

// Proxy URL — set via app.json extra or environment variable
const PROXY_BASE_URL =
  (Constants.expoConfig?.extra?.sttProxyUrl as string) || '';

// Enforce HTTPS at init time
if (PROXY_BASE_URL && !PROXY_BASE_URL.startsWith('https://')) {
  throw new Error('STT proxy URL must use HTTPS.');
}

const DEVICE_ID_STORAGE_KEY = 'vocis_device_id';
const TOKEN_REQUEST_TIMEOUT_MS = 10_000; // 10 seconds

/**
 * Get a stable, unique device identifier for rate limiting.
 * Generated once on first launch and stored in AsyncStorage.
 * Does NOT use deprecated Constants.installationId.
 */
async function getDeviceId(): Promise<string> {
  let id = await AsyncStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (id && id.length >= 10) return id;

  // Generate a cryptographically random device ID
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  await AsyncStorage.setItem(DEVICE_ID_STORAGE_KEY, id);
  return id;
}

export interface SessionToken {
  token: string;
  expires_in: number;
  websocket_url: string;
}

export const STTProxy = {
  /**
   * Check if proxy mode is configured.
   */
  isEnabled(): boolean {
    return PROXY_BASE_URL.length > 0;
  },

  /**
   * Request a session token from the proxy server.
   * Token is short-lived and single-use.
   * Includes a 10-second timeout to prevent indefinite hangs.
   */
  async requestToken(): Promise<SessionToken> {
    if (!PROXY_BASE_URL) {
      throw new Error('STT proxy URL not configured.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TOKEN_REQUEST_TIMEOUT_MS);

    try {
      const deviceId = await getDeviceId();
      const response = await fetch(`${PROXY_BASE_URL}/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-ID': deviceId,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const error = (body as Record<string, string>).error || `Server error (${response.status})`;
        throw new Error(error);
      }

      return response.json() as Promise<SessionToken>;
    } finally {
      clearTimeout(timeout);
    }
  },

  /**
   * Build the WebSocket URL for streaming.
   * Token is NOT in the URL — it's passed via Sec-WebSocket-Protocol header.
   */
  getWebSocketUrl(): string {
    const wsBase = PROXY_BASE_URL.replace(/^https/, 'wss');
    return `${wsBase}/stream`;
  },

  /**
   * Get the Sec-WebSocket-Protocol value for passing the token.
   * Format: "token.{tokenValue}"
   */
  getWebSocketProtocol(token: string): string {
    return `token.${token}`;
  },

  /**
   * Direct mode is disabled — API keys must never appear in WebSocket URLs
   * because browser/runtime error output exposes the full URL on failure.
   * All connections must go through the Cloudflare Worker proxy.
   */
  async getDirectWebSocketUrl(): Promise<string | null> {
    return null;
  },
};
