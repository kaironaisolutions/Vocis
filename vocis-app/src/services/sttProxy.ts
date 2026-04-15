import Constants from 'expo-constants';
import { SecureStorage } from './secureStorage';

/**
 * STT Proxy client — requests session tokens from the Cloudflare Worker
 * instead of sending the API key directly to ElevenLabs.
 *
 * The Worker holds the real ElevenLabs API key server-side.
 * The app only receives a short-lived, single-use session token.
 */

// Read the proxy URL fresh on each call so module-load timing never causes a stale empty string.
function getProxyBaseUrl(): string {
  const url = (Constants.expoConfig?.extra?.sttProxyUrl as string) || '';
  return url;
}

/**
 * Get a unique device identifier for rate limiting.
 * Uses Constants.installationId (deprecated but still present) or falls back to sessionId.
 */
function getDeviceId(): string {
  // installationId is deprecated in SDK 51+ but still available in most SDK 54 builds.
  // sessionId is a per-launch UUID — less stable, but always present.
  const id =
    (Constants as any).installationId ||
    Constants.sessionId ||
    'unknown-device';
  // Do NOT log the device ID — it is a persistent identifier.
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
   * Falls back to direct API key mode if no proxy URL is set.
   */
  isEnabled(): boolean {
    const url = getProxyBaseUrl();
    console.log('[STT] Proxy URL:', url || '(not set — will use direct mode)');
    return url.length > 0;
  },

  /**
   * Request a session token from the proxy server.
   * Token is short-lived (5 minutes) and single-use.
   */
  async requestToken(): Promise<SessionToken> {
    const proxyUrl = getProxyBaseUrl();
    if (!proxyUrl) {
      throw new Error('STT proxy URL not configured.');
    }

    const deviceId = getDeviceId();
    const tokenUrl = `${proxyUrl}/token`;
    console.log('[STT] Fetching token from:', tokenUrl);

    let response: Response;
    try {
      response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-ID': deviceId,
        },
      });
    } catch (fetchErr) {
      console.error('[STT] Token fetch network error:', fetchErr);
      throw new Error(`Token fetch failed (network error): ${fetchErr}`);
    }

    console.log('[STT] Token response status:', response.status);

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error('[STT] Token error body:', body);
      throw new Error(
        `Token request failed: HTTP ${response.status} — ${body || 'no body'}`
      );
    }

    const data = (await response.json()) as SessionToken;
    console.log('[STT] Token received:', data.token ? data.token.slice(0, 20) + '...' : 'EMPTY');
    return data;
  },

  /**
   * Build the WebSocket URL for streaming.
   * Uses the proxy's /stream endpoint with the session token.
   */
  getWebSocketUrl(token: string): string {
    const wsBase = getProxyBaseUrl().replace(/^http/, 'ws');
    const wsUrl = new URL('/stream', wsBase);
    wsUrl.searchParams.set('token', token);
    // Scribe v2 Realtime session config is passed as query params so the
    // Worker can forward them to ElevenLabs when opening the upstream connection.
    wsUrl.searchParams.set('model_id', 'scribe_v2_realtime');
    wsUrl.searchParams.set('language_code', 'en');
    wsUrl.searchParams.set('sample_rate', '16000');
    const finalUrl = wsUrl.toString();
    console.log('[STT] Proxy WS URL:', finalUrl.replace(/token=[^&]+/, 'token=<redacted>'));
    return finalUrl;
  },

  /**
   * Build the direct ElevenLabs WebSocket URL (fallback mode).
   * Used when no proxy is configured and API key is stored locally.
   */
  async getDirectWebSocketUrl(): Promise<string | null> {
    console.log('[STT] WARNING: Using direct ElevenLabs connection (no proxy configured)');
    const apiKey = await SecureStorage.getApiKey();
    if (!apiKey) {
      console.log('[STT] No local API key found');
      return null;
    }
    // xi_api_key is the correct ElevenLabs query param name for WebSocket auth.
    // The key is intentionally in the URL because React Native's WebSocket
    // implementation does not support custom headers.
    const url = `wss://api.elevenlabs.io/v1/speech-to-text/realtime?xi_api_key=${apiKey}&model_id=scribe_v2_realtime&language_code=en&sample_rate=16000`;
    console.log('[STT] Direct WS URL: wss://api.elevenlabs.io/v1/speech-to-text/realtime?xi_api_key=<redacted>&...');
    return url;
  },
};
