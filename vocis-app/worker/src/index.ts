/**
 * Vocis STT Proxy — Cloudflare Worker
 *
 * Purpose: Keeps the ElevenLabs API key server-side so it never reaches
 * the mobile app. The app requests a short-lived session token, then
 * connects to this Worker's WebSocket endpoint which proxies audio
 * to ElevenLabs.
 *
 * Flow:
 * 1. App → POST /token (with device ID) → Worker returns HMAC-signed token
 * 2. App → WSS /stream (token via Sec-WebSocket-Protocol) → Worker verifies
 *    HMAC, opens upstream WS to ElevenLabs with the real API key
 * 3. Audio/transcripts are relayed bidirectionally
 * 4. Worker enforces per-device rate limits + per-connection message throttling
 *
 * Tokens are stateless (HMAC-signed) so they work across all Worker isolates.
 * No shared in-memory state required for token validation.
 *
 * Secrets required (set via `wrangler secret put`):
 *   ELEVENLABS_API_KEY  — ElevenLabs API key
 *   TOKEN_SECRET        — Random string for HMAC signing, e.g. openssl rand -hex 32
 *
 * Deploy:
 *   cd worker
 *   npm install
 *   wrangler secret put ELEVENLABS_API_KEY
 *   wrangler secret put TOKEN_SECRET
 *   wrangler deploy
 */

interface Env {
  ELEVENLABS_API_KEY: string;
  TOKEN_SECRET: string;
  RATE_LIMIT_HOURLY: string;
  RATE_LIMIT_DAILY: string;
  TOKEN_TTL_SECONDS: string;
}

// Allowed origins for WebSocket upgrade (native apps send no Origin header)
const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/vocis\.kaironai\.com$/,
  /^https:\/\/.*\.kaironai\.workers\.dev$/,
  /^http:\/\/localhost(:\d+)?$/,
];

// Per-device rate tracking (in-memory — per isolate, best-effort)
const deviceUsage = new Map<string, { hourly: number[]; daily: { date: string; count: number } }>();

// Session timeout: 30 minutes
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

// WebSocket message rate limit: max messages per second per connection
const WS_MAX_MESSAGES_PER_SECOND = 100;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // /health — CORS allowed for monitoring
    if (url.pathname === '/health') {
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      };
      if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
      }
      return new Response(
        JSON.stringify({ status: 'ok' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // OPTIONS preflight — no CORS for /token or /stream (mobile apps don't need it)
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204 });
    }

    if (url.pathname === '/token' && request.method === 'POST') {
      return handleTokenRequest(request, env);
    }

    if (url.pathname === '/stream') {
      const upgradeHeader = request.headers.get('Upgrade');
      if (upgradeHeader?.toLowerCase() === 'websocket') {
        return handleWebSocket(request, env);
      }
      return new Response('Expected WebSocket upgrade.', { status: 426 });
    }

    return new Response('Not Found', { status: 404 });
  },
};

/**
 * POST /token — Issue a stateless HMAC-signed session token.
 * Token format: {deviceId}.{expiresAt}.{hmacHex}
 * Verifiable by any Worker isolate — no shared in-memory state required.
 */
async function handleTokenRequest(
  request: Request,
  env: Env
): Promise<Response> {
  // Validate Content-Type is present
  const contentType = request.headers.get('Content-Type');
  if (!contentType) {
    return jsonResponse({ error: 'Content-Type header is required.' }, 400);
  }

  const deviceId = request.headers.get('X-Device-ID');
  if (!deviceId || deviceId.length < 10 || deviceId.length > 128) {
    return jsonResponse({ error: 'Missing or invalid X-Device-ID header.' }, 400);
  }

  // Validate device ID format (alphanumeric + hyphens/underscores only — no dots, preserves token format)
  if (!/^[a-zA-Z0-9\-_]+$/.test(deviceId)) {
    return jsonResponse({ error: 'Invalid device ID format.' }, 400);
  }

  // Check rate limits
  const rateCheck = checkRateLimit(deviceId, env);
  if (!rateCheck.allowed) {
    return jsonResponse({ error: rateCheck.reason }, 429);
  }

  // Require secrets to be configured — never use fallbacks
  if (!env.ELEVENLABS_API_KEY) {
    return jsonResponse({ error: 'Service temporarily unavailable.' }, 503);
  }

  if (!env.TOKEN_SECRET) {
    return jsonResponse({ error: 'Service temporarily unavailable.' }, 503);
  }

  // Validate TTL bounds (30–300 seconds, default 60)
  const rawTtl = parseInt(env.TOKEN_TTL_SECONDS || '60', 10);
  const ttl = Math.max(30, Math.min(300, isNaN(rawTtl) ? 60 : rawTtl));

  const token = await createStatelessToken(deviceId, ttl, env);

  // Record usage
  recordUsage(deviceId);

  return jsonResponse(
    {
      token,
      expires_in: ttl,
      websocket_url: '/stream',
    },
    200
  );
}

/**
 * WSS /stream — WebSocket proxy to ElevenLabs.
 * Token passed via Sec-WebSocket-Protocol header as "token.{tokenValue}".
 * Validates the HMAC-signed session token (stateless, works across isolates),
 * then relays audio/transcripts bidirectionally.
 */
async function handleWebSocket(request: Request, env: Env): Promise<Response> {
  // Origin validation: accept if no Origin (native apps) or if Origin matches allowed patterns
  const origin = request.headers.get('Origin');
  if (origin) {
    const originAllowed = ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
    if (!originAllowed) {
      return new Response('Forbidden: origin not allowed.', { status: 403 });
    }
  }

  // Extract token from Sec-WebSocket-Protocol header
  // Client sends: Sec-WebSocket-Protocol: token.{tokenValue}
  const protocolHeader = request.headers.get('Sec-WebSocket-Protocol');
  let token: string | null = null;

  if (protocolHeader) {
    // Protocol header may contain comma-separated values
    const protocols = protocolHeader.split(',').map((p) => p.trim());
    for (const proto of protocols) {
      if (proto.startsWith('token.')) {
        token = proto.slice('token.'.length);
        break;
      }
    }
  }

  if (!token) {
    return new Response('Missing token in Sec-WebSocket-Protocol header.', { status: 401 });
  }

  // Require secrets
  if (!env.TOKEN_SECRET) {
    return new Response('Service temporarily unavailable.', { status: 503 });
  }

  // Validate HMAC-signed token (stateless — no shared memory needed)
  const deviceId = await validateStatelessToken(token, env);
  if (!deviceId) {
    return new Response('Invalid or expired token.', { status: 401 });
  }

  if (!env.ELEVENLABS_API_KEY) {
    return new Response('Service temporarily unavailable.', { status: 503 });
  }

  // Create WebSocket pair for the client
  const [client, server] = Object.values(new WebSocketPair());

  // Accept the client connection, echoing back the protocol so the handshake completes
  server.accept();

  // Connect upstream to ElevenLabs using fetch-based WebSocket upgrade.
  // This allows us to pass the xi-api-key header (new WebSocket() cannot).
  // Cloudflare fetch() requires https:// — the Upgrade header handles WS upgrade
  const upstreamUrl = 'https://api.elevenlabs.io/v1/speech-to-text/stream';

  let upstream: WebSocket;
  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      headers: {
        'Upgrade': 'websocket',
        'xi-api-key': env.ELEVENLABS_API_KEY,
      },
    });

    const ws = upstreamResponse.webSocket;
    if (!ws) {
      server.close(1011, 'Upstream connection failed');
      return new Response(null, {
        status: 101,
        webSocket: client,
        headers: { 'Sec-WebSocket-Protocol': `token.${token}` },
      });
    }

    upstream = ws;
    upstream.accept();
  } catch {
    server.close(1011, 'Upstream connection failed');
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { 'Sec-WebSocket-Protocol': `token.${token}` },
    });
  }

  // --- Per-connection message rate limiting ---
  let messageTimestamps: number[] = [];

  // --- Server-side session timeout (30 minutes) ---
  const sessionTimer = setTimeout(() => {
    try {
      server.close(1000, 'Session timeout');
    } catch { /* already closed */ }
    try {
      upstream.close(1000, 'Session timeout');
    } catch { /* already closed */ }
  }, SESSION_TIMEOUT_MS);

  // Helper to clean up timeout on connection close
  const clearSessionTimer = () => {
    clearTimeout(sessionTimer);
  };

  // Relay: client → upstream (with rate limiting)
  server.addEventListener('message', (event) => {
    const now = Date.now();

    // Prune timestamps older than 1 second
    messageTimestamps = messageTimestamps.filter((t) => now - t < 1000);
    messageTimestamps.push(now);

    if (messageTimestamps.length > WS_MAX_MESSAGES_PER_SECOND) {
      // Rate limit exceeded — close with policy violation
      clearSessionTimer();
      try {
        server.close(1008, 'Message rate limit exceeded');
      } catch { /* already closed */ }
      try {
        upstream.close(1000, 'Client rate limited');
      } catch { /* already closed */ }
      return;
    }

    try {
      upstream.send(event.data);
    } catch {
      // Upstream may have closed
    }
  });

  server.addEventListener('close', () => {
    clearSessionTimer();
    try {
      upstream.close(1000, 'Client disconnected');
    } catch {
      // Already closed
    }
  });

  // Relay: upstream → client
  upstream.addEventListener('message', (event: MessageEvent) => {
    try {
      server.send(event.data);
    } catch {
      // Client may have disconnected
    }
  });

  upstream.addEventListener('close', (event: CloseEvent) => {
    clearSessionTimer();
    try {
      server.close(event.code || 1000, event.reason || 'Upstream closed');
    } catch {
      // Already closed
    }
  });

  upstream.addEventListener('error', () => {
    clearSessionTimer();
    try {
      server.close(1011, 'Upstream connection error');
    } catch {
      // Already closed
    }
  });

  return new Response(null, {
    status: 101,
    webSocket: client,
    headers: { 'Sec-WebSocket-Protocol': `token.${token}` },
  });
}

// --- Stateless HMAC Token ---

/**
 * Create a stateless token: "{deviceId}.{expiresAt}.{hmacHex}"
 * HMAC-SHA256 signed with TOKEN_SECRET — verifiable by any Worker isolate.
 */
async function createStatelessToken(deviceId: string, ttlSeconds: number, env: Env): Promise<string> {
  const expiresAt = Date.now() + ttlSeconds * 1000;
  const payload = `${deviceId}.${expiresAt}`;
  const sig = await hmacSHA256(payload, env.TOKEN_SECRET);
  return `${payload}.${sig}`;
}

/**
 * Validate a stateless token using constant-time HMAC comparison.
 * Returns deviceId on success, null on failure.
 */
async function validateStatelessToken(token: string, env: Env): Promise<string | null> {
  // Token format: {deviceId}.{expiresAt}.{hmacHex}
  // deviceId is [a-zA-Z0-9-_]+ (no dots), so last two segments are expiresAt and sig
  const lastDot = token.lastIndexOf('.');
  if (lastDot === -1) return null;
  const sig = token.slice(lastDot + 1);
  const rest = token.slice(0, lastDot);

  const prevDot = rest.lastIndexOf('.');
  if (prevDot === -1) return null;
  const expiresAtStr = rest.slice(prevDot + 1);
  const deviceId = rest.slice(0, prevDot);

  // Check expiry
  const expiresAt = parseInt(expiresAtStr, 10);
  if (isNaN(expiresAt) || Date.now() > expiresAt) return null;

  // Validate deviceId format
  if (!/^[a-zA-Z0-9\-_]{10,128}$/.test(deviceId)) return null;

  // Verify HMAC using constant-time comparison via crypto.subtle.verify
  const payload = `${deviceId}.${expiresAtStr}`;
  const isValid = await hmacVerify(payload, sig, env.TOKEN_SECRET);
  if (!isValid) return null;

  return deviceId;
}

/**
 * Sign data with HMAC-SHA256 and return hex string.
 */
async function hmacSHA256(data: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Constant-time HMAC verification using crypto.subtle.verify.
 * Converts the provided hex signature back to bytes and uses the
 * WebCrypto verify method which performs timing-safe comparison.
 */
async function hmacVerify(data: string, sigHex: string, secret: string): Promise<boolean> {
  // Validate hex format before parsing
  if (!/^[a-f0-9]{64}$/.test(sigHex)) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );

  // Convert hex signature to bytes
  const sigBytes = new Uint8Array(sigHex.length / 2);
  for (let i = 0; i < sigBytes.length; i++) {
    sigBytes[i] = parseInt(sigHex.slice(i * 2, i * 2 + 2), 16);
  }

  return crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(data));
}

// --- Rate Limiting ---

function checkRateLimit(
  deviceId: string,
  env: Env
): { allowed: boolean; reason?: string } {
  const maxHourly = parseInt(env.RATE_LIMIT_HOURLY || '20', 10);
  const maxDaily = parseInt(env.RATE_LIMIT_DAILY || '120', 10);
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const today = new Date().toISOString().split('T')[0];

  let usage = deviceUsage.get(deviceId);
  if (!usage) {
    usage = { hourly: [], daily: { date: today, count: 0 } };
    deviceUsage.set(deviceId, usage);
  }

  // Clean old hourly entries
  usage.hourly = usage.hourly.filter((t) => t > oneHourAgo);

  // Reset daily counter on new day
  if (usage.daily.date !== today) {
    usage.daily = { date: today, count: 0 };
  }

  if (usage.hourly.length >= maxHourly) {
    return { allowed: false, reason: 'Rate limit exceeded. Try again later.' };
  }

  if (usage.daily.count >= maxDaily) {
    return { allowed: false, reason: 'Rate limit exceeded. Try again tomorrow.' };
  }

  return { allowed: true };
}

function recordUsage(deviceId: string) {
  let usage = deviceUsage.get(deviceId);
  const today = new Date().toISOString().split('T')[0];

  if (!usage) {
    usage = { hourly: [], daily: { date: today, count: 0 } };
    deviceUsage.set(deviceId, usage);
  }

  usage.hourly.push(Date.now());
  if (usage.daily.date === today) {
    usage.daily.count++;
  } else {
    usage.daily = { date: today, count: 1 };
  }
}

// --- Utilities ---

function jsonResponse(
  data: Record<string, unknown>,
  status: number,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}
