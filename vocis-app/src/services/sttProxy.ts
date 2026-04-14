import Constants from 'expo-constants';
import { SecureStorage } from './secureStorage';

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

/**
 * Get a unique device identifier for rate limiting.
 * Uses Constants.installationId which is stable per app install.
 */
function getDeviceId(): string {
  return Constants.installationId || 'unknown-device';
}

export interface SessionToken {
  token: string;
  expires_in: number;
  websocket_url: string;
}

export const STTProxy = {
  /**
   * Check if proxy mode is configured.
   * Falls back to direct API key mode if no proxy URL is set.
   */
  isEnabled(): boolean {
    return PROXY_BASE_URL.length > 0;
  },

  /**
   * Request a session token from the proxy server.
   * Token is short-lived (5 minutes) and single-use.
   */
  async requestToken(): Promise<SessionToken> {
    if (!PROXY_BASE_URL) {
      throw new Error('STT proxy URL not configured.');
    }

    const response = await fetch(`${PROXY_BASE_URL}/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-ID': getDeviceId(),
      },
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const error = (body as Record<string, string>).error || `Server error (${response.status})`;
      throw new Error(error);
    }

    return response.json() as Promise<SessionToken>;
  },

  /**
   * Build the WebSocket URL for streaming.
   * Uses the proxy's /stream endpoint with the session token.
   */
  getWebSocketUrl(token: string): string {
    const wsBase = PROXY_BASE_URL.replace(/^http/, 'ws');
    return `${wsBase}/stream?token=${token}`;
  },

  /**
   * Build the direct ElevenLabs WebSocket URL (fallback mode).
   * Used when no proxy is configured and API key is stored locally.
   */
  async getDirectWebSocketUrl(): Promise<string | null> {
    const apiKey = await SecureStorage.getApiKey();
    if (!apiKey) return null;
    return `wss://api.elevenlabs.io/v1/speech-to-text/stream?xi_api_key=${apiKey}`;
  },
};
