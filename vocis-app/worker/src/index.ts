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
 * 2. App → WSS /stream?token=xxx → Worker verifies HMAC, opens upstream WS
 *    to ElevenLabs with the real API key
 * 3. Audio/transcripts are relayed bidirectionally
 * 4. Worker enforces per-device rate limits
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

// Per-device rate tracking (in-memory — per isolate, best-effort)
const deviceUsage = new Map<string, { hourly: number[]; daily: { date: string; count: number } }>();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS headers for mobile app
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Device-ID',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (url.pathname === '/token' && request.method === 'POST') {
      return handleTokenRequest(request, env, corsHeaders);
    }

    if (url.pathname === '/stream') {
      const upgradeHeader = request.headers.get('Upgrade');
      if (upgradeHeader?.toLowerCase() === 'websocket') {
        return handleWebSocket(request, env);
      }
      return new Response('Expected WebSocket upgrade.', { status: 426 });
    }

    if (url.pathname === '/health') {
      return new Response(
        JSON.stringify({
          status: 'ok',
          apiKeyConfigured: Boolean(env.ELEVENLABS_API_KEY),
          apiKeyLength: env.ELEVENLABS_API_KEY?.length ?? 0,
          tokenSecretConfigured: Boolean(env.TOKEN_SECRET),
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const deviceId = request.headers.get('X-Device-ID');
  if (!deviceId || deviceId.length < 10 || deviceId.length > 128) {
    return jsonResponse({ error: 'Missing or invalid X-Device-ID header.' }, 400, corsHeaders);
  }

  // Validate device ID format (alphanumeric + hyphens/underscores only — no dots, preserves token format)
  if (!/^[a-zA-Z0-9\-_]+$/.test(deviceId)) {
    return jsonResponse({ error: 'Invalid device ID format.' }, 400, corsHeaders);
  }

  // Check rate limits
  const rateCheck = checkRateLimit(deviceId, env);
  if (!rateCheck.allowed) {
    return jsonResponse({ error: rateCheck.reason }, 429, corsHeaders);
  }

  if (!env.ELEVENLABS_API_KEY) {
    return jsonResponse(
      { error: 'Server configuration error: API key not set. Contact support.' },
      503,
      corsHeaders
    );
  }

  // Generate stateless HMAC-signed token
  const ttl = parseInt(env.TOKEN_TTL_SECONDS || '300', 10);
  const token = await createStatelessToken(deviceId, ttl, env);

  // Record usage
  recordUsage(deviceId);

  return jsonResponse(
    {
      token,
      expires_in: ttl,
      websocket_url: '/stream',
    },
    200,
    corsHeaders
  );
}

/**
 * WSS /stream?token=xxx — WebSocket proxy to ElevenLabs.
 * Validates the HMAC-signed session token (stateless, works across isolates),
 * then relays audio/transcripts bidirectionally.
 */
async function handleWebSocket(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) {
    return new Response('Missing token parameter.', { status: 401 });
  }

  // Validate HMAC-signed token (stateless — no shared memory needed)
  const deviceId = await validateStatelessToken(token, env);
  if (!deviceId) {
    return new Response('Invalid or expired token.', { status: 401 });
  }

  if (!env.ELEVENLABS_API_KEY) {
    return new Response('Server configuration error: API key not set.', { status: 503 });
  }

  // Connect to ElevenLabs BEFORE accepting the client WebSocket.
  // CF Workers fetch() only accepts https:// — wss:// throws TypeError.
  // The runtime performs the HTTP→WS upgrade internally when it sees
  // Upgrade: websocket in the request headers.
  console.log('[WS] Connecting to ElevenLabs — API key length:', env.ELEVENLABS_API_KEY?.length ?? 0);

  let elevenLabsResp: Response;
  try {
    elevenLabsResp = await fetch(
      'https://api.elevenlabs.io/v1/speech-to-text/stream',
      {
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade',
          'xi-api-key': env.ELEVENLABS_API_KEY,
        },
      }
    );
    console.log('[WS] ElevenLabs fetch status:', elevenLabsResp.status, '— has webSocket:', !!elevenLabsResp.webSocket);
  } catch (e) {
    console.error('[WS] ElevenLabs fetch threw:', e);
    return new Response('ElevenLabs fetch failed.', { status: 502 });
  }

  const upstream = elevenLabsResp.webSocket;

  if (!upstream) {
    const body = await elevenLabsResp.text().catch(() => '');
    console.error(`[WS] ElevenLabs rejected connection — HTTP ${elevenLabsResp.status} — ${body}`);
    // Accept the client pair so we can cleanly close it
    const [clientErr, serverErr] = Object.values(new WebSocketPair());
    serverErr.accept();
    serverErr.close(1011, 'Upstream connection error');
    return new Response(null, { status: 101, webSocket: clientErr });
  }

  upstream.accept();
  console.log('[WS] ElevenLabs connected successfully');

  // Now accept the client WebSocket
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  console.log('[WS] Client WebSocket accepted');

  let firstMessage = true;
  let audioChunkCount = 0;

  // App → ElevenLabs: transform message format
  server.addEventListener('message', (event) => {
    try {
      if (typeof event.data !== 'string') {
        // Raw binary — forward directly (shouldn't happen with current app but safe)
        upstream.send(event.data);
        return;
      }

      const msg = JSON.parse(event.data) as Record<string, unknown>;

      if (msg.type === 'config') {
        // App sends {type:'config',...} as its first message.
        // ElevenLabs Scribe v2 expects {model:'scribe_v2'} as the first message instead.
        if (firstMessage) {
          firstMessage = false;
          const initMsg = JSON.stringify({ model: 'scribe_v2' });
          console.log('[WS] Sending ElevenLabs init:', initMsg);
          upstream.send(initMsg);
        }
        return;
      }

      if (msg.type === 'audio' && typeof msg.audio === 'string') {
        // Transform: {type:'audio', audio:'b64'} → {audio:'b64', flush:false}
        if (firstMessage) {
          // App skipped config — send init before first audio chunk
          firstMessage = false;
          upstream.send(JSON.stringify({ model: 'scribe_v2' }));
          console.log('[WS] Sent late ElevenLabs init before first audio chunk');
        }
        audioChunkCount++;
        if (audioChunkCount === 1) {
          console.log('[WS] First audio chunk received — streaming started');
        }
        upstream.send(JSON.stringify({ audio: msg.audio, flush: false }));
        return;
      }

      if (msg.type === 'flush') {
        // Transform: {type:'flush'} → {flush:true}
        console.log(`[WS] Flush received after ${audioChunkCount} audio chunks`);
        upstream.send(JSON.stringify({ flush: true }));
        return;
      }

      // Unknown message type — forward as-is
      upstream.send(event.data);
    } catch {
      // Non-JSON — forward raw
      try { upstream.send(event.data); } catch { /* upstream closed */ }
    }
  });

  server.addEventListener('close', () => {
    console.log('[WS] Client disconnected');
    try { upstream.close(1000, 'Client disconnected'); } catch { /* already closed */ }
  });

  // ElevenLabs → app: forward transcript responses directly
  upstream.addEventListener('message', (event: MessageEvent) => {
    try {
      if (typeof event.data === 'string') {
        console.log('[WS] ElevenLabs →', event.data.slice(0, 120));
      }
      server.send(event.data);
    } catch {
      // Client may have disconnected
    }
  });

  upstream.addEventListener('close', (event: CloseEvent) => {
    console.log(`[WS] ElevenLabs closed: code=${event.code} reason=${event.reason}`);
    try { server.close(event.code || 1000, event.reason || 'Upstream closed'); } catch { /* already closed */ }
  });

  upstream.addEventListener('error', (err) => {
    console.error('[WS] ElevenLabs error:', err);
    try { server.close(1011, 'Upstream error'); } catch { /* already closed */ }
  });

  return new Response(null, {
    status: 101,
    webSocket: client,
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
  const sig = await hmacSHA256(payload, env.TOKEN_SECRET || generateFallbackSecret());
  return `${payload}.${sig}`;
}

/**
 * Validate a stateless token. Returns deviceId on success, null on failure.
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

  // Verify HMAC
  const payload = `${deviceId}.${expiresAtStr}`;
  const expectedSig = await hmacSHA256(payload, env.TOKEN_SECRET || generateFallbackSecret());
  if (sig !== expectedSig) return null;

  return deviceId;
}

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

// Stable per-process fallback for TOKEN_SECRET when not configured.
// Not secure across isolates — set TOKEN_SECRET as a Cloudflare secret.
let _fallbackSecret: string | null = null;
function generateFallbackSecret(): string {
  if (!_fallbackSecret) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    _fallbackSecret = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return _fallbackSecret;
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
    return { allowed: false, reason: `Hourly limit (${maxHourly}) reached. Try again later.` };
  }

  if (usage.daily.count >= maxDaily) {
    return { allowed: false, reason: `Daily limit (${maxDaily}) reached. Try again tomorrow.` };
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
  headers: Record<string, string>
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}
