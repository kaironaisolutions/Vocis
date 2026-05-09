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

/**
 * ElevenLabs Scribe v2 Realtime keyterm biasing.
 *
 * Per the official docs, keyterms must be passed as repeated query
 * parameters on the WebSocket URL (NOT as a session_config message
 * after connection — that's silently ignored). Constraints:
 *   - max 50 keyterms per session
 *   - each keyterm max 20 chars
 *   - +20% cost premium when keyterms are used
 *
 * The list is curated from real Vocis inventory: the 50 most-spoken
 * brand and garment terms. Whole list lives in the Worker because
 * that's where the upstream URL is built; the app's
 * src/constants/keyterms.ts is now reference-only / used by the
 * Settings UI for the user-extension AsyncStorage list.
 */
const PRIORITY_KEYTERMS: readonly string[] = [
  // Brands (highest STT-mishear risk)
  'Carhartt', 'Patagonia', 'Woolrich', 'Pendleton',
  'Dickies', 'Wrangler', 'Polo', 'Nike',
  'Nautica', 'Tommy', 'Levis', 'Eddie Bauer',
  'Harley', 'North Face', 'Columbia', 'LL Bean',
  'Filson', 'Lands End', 'Coogi', 'Quiksilver',
  'Champion', 'Lee', 'Ralph Lauren', 'GAP',
  'Starter', 'FUBU', 'Karl Kani', 'Rocawear',
  'Nascar',
  // Garment types most often mistranscribed
  'windbreaker', 'harrington', 'chore coat',
  'barn coat', 'flannel', 'trucker',
  'carpenters', 'crewneck', 'cardigan',
  'bomber', 'blazer', 'pullover',
  'corduroy', 'fleece', 'hoodie',
  'cableknit', 'shacket', 'rugby',
  'overalls',
  // Price-context word so dropped "dollars" still gets recognized
  'dollars',
];

// Per-device rate tracking — in-memory, per Cloudflare Worker isolate.
//
// LIMITATION: Under high load CF may spin up multiple isolates, each with
// independent counters. A determined user could exceed limits via isolate spread.
//
// For beta / TestFlight: in-memory limits are sufficient (single user, low traffic).
//
// Production upgrade path:
//   Option A — Cloudflare KV (eventually consistent, ~100ms reads):
//     const count = await env.RATE_LIMIT_KV.get(deviceId);
//   Option B — Durable Objects (strongly consistent, single-instance state):
//     const stub = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(deviceId));
//     const resp = await stub.fetch(request);
//
// Upgrade before public launch if user base grows beyond private beta.
const deviceUsage = new Map<string, { hourly: number[]; daily: { date: string; count: number } }>();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Fail immediately if required secrets are not configured.
    // Without TOKEN_SECRET the HMAC is meaningless (tokens are unforgeable only with it).
    if (!env.TOKEN_SECRET) {
      console.error('FATAL: TOKEN_SECRET secret is not configured. Run: wrangler secret put TOKEN_SECRET');
      return new Response('Server misconfiguration.', { status: 503 });
    }
    if (!env.ELEVENLABS_API_KEY) {
      console.error('FATAL: ELEVENLABS_API_KEY secret is not configured.');
      return new Response('Server misconfiguration.', { status: 503 });
    }

    const url = new URL(request.url);

    // CORS resolution.
    //
    // Mobile apps (React Native) do not send an Origin header, so they are
    // unaffected. Web clients we want to support:
    //   - https://vocis-app.com   (production web)
    //   - exp:// , vocis://       (deep links)
    //   - http://localhost:*      (Expo web dev server, default :8081)
    //   - http://127.0.0.1:*
    //   - https://*.expo.dev      (Expo tunnel domains)
    //
    // Anything else gets a wildcard fallback. The actual security boundaries
    // are HMAC-signed tokens on /stream and per-device rate limits on
    // /token, not CORS — CORS is just the browser's same-origin politeness
    // layer. The previous implementation set the header to the literal
    // string "null" for unknown origins, which Chrome treats as an invalid
    // value and refuses, blocking every web request including /health.
    const origin = request.headers.get('Origin') ?? '';
    const ALLOW_PREFIXES = ['https://vocis-app.com', 'exp://', 'vocis://'];
    const ALLOW_PATTERNS = [
      /^https?:\/\/localhost(:\d+)?$/,
      /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
      /^https:\/\/[a-z0-9-]+\.expo\.dev$/,
    ];
    const isAllowedOrigin =
      origin !== '' &&
      (ALLOW_PREFIXES.some((p) => origin.startsWith(p)) ||
        ALLOW_PATTERNS.some((p) => p.test(origin)));
    const corsOrigin = origin === '' ? '*' : isAllowedOrigin ? origin : '*';
    const corsHeaders = {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Device-ID',
      'Access-Control-Max-Age': '86400',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
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
  // Accept deviceId from either the X-Device-ID header (native client
  // pattern) OR the JSON body (web client pattern — browsers can't always
  // attach custom headers to fetches that follow CORS preflights cleanly,
  // and the app's web flow puts deviceId in the body).
  let deviceId = request.headers.get('X-Device-ID');
  if (!deviceId) {
    try {
      const body = (await request.clone().json()) as { deviceId?: unknown };
      if (typeof body.deviceId === 'string') {
        deviceId = body.deviceId;
      }
    } catch {
      // Body was missing or not JSON — header was the only source, and it
      // wasn't there either. Fall through to the missing-deviceId error.
    }
  }

  if (!deviceId || deviceId.length < 10 || deviceId.length > 128) {
    return jsonResponse(
      { error: 'Missing deviceId. Provide via X-Device-ID header or JSON body { "deviceId": "..." }.' },
      400,
      corsHeaders
    );
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

  // Connect to ElevenLabs BEFORE accepting the client WebSocket.
  // CF Workers fetch() only accepts https:// — wss:// throws TypeError.
  // Forward config query params (model_id, language_code, sample_rate) from
  // the client request to ElevenLabs so the app controls session parameters.
  const elevenLabsUrl = new URL('https://api.elevenlabs.io/v1/speech-to-text/realtime');
  const forwardParams = ['model_id', 'language_code', 'sample_rate'];
  for (const param of forwardParams) {
    const value = url.searchParams.get(param);
    if (value) elevenLabsUrl.searchParams.set(param, value);
  }

  // Keyterm biasing — repeated `keyterms=` query parameters per the
  // ElevenLabs Scribe v2 Realtime spec. Filter to comply with the
  // documented limits (≤50 entries, ≤20 chars each).
  const validKeyterms = PRIORITY_KEYTERMS.filter((k) => k.length <= 20).slice(0, 50);
  for (const term of validKeyterms) {
    elevenLabsUrl.searchParams.append('keyterms', term);
  }

  // no_verbatim removes filler words ("um", "uh", "like", "you know")
  // from transcripts before they reach us, which means they never
  // pollute the parser's item-name extraction.
  elevenLabsUrl.searchParams.set('no_verbatim', 'true');

  // Diagnostic: dump enough of the upstream URL to confirm keyterms
  // are present (search for "keyterms=" in `wrangler tail` output).
  // Truncated to 300 chars so the log stays readable.
  const upstreamUrlString = elevenLabsUrl.toString();
  console.log('[WS] Keyterms in URL:', validKeyterms.length, validKeyterms.slice(0, 5).join(','));
  console.log('[WS] Upstream URL (first 300):', upstreamUrlString.slice(0, 300));
  console.log('[WS] Connecting to ElevenLabs Scribe v2 Realtime...');

  let elevenLabsResp: Response;
  try {
    elevenLabsResp = await fetch(upstreamUrlString, {
      headers: {
        'Upgrade': 'websocket',
        'Connection': 'Upgrade',
        'xi-api-key': env.ELEVENLABS_API_KEY,
      },
    });
    console.log('[WS] ElevenLabs fetch status:', elevenLabsResp.status, '— has webSocket:', !!elevenLabsResp.webSocket);
  } catch (e) {
    console.error('[WS] ElevenLabs fetch threw:', e);
    return new Response('ElevenLabs fetch failed.', { status: 502 });
  }

  const upstream = elevenLabsResp.webSocket;

  if (!upstream) {
    console.error(`[WS] ElevenLabs rejected connection — HTTP ${elevenLabsResp.status}`);
    const [clientErr, serverErr] = Object.values(new WebSocketPair());
    serverErr.accept();
    serverErr.close(1011, 'Upstream connection error');
    return new Response(null, { status: 101, webSocket: clientErr });
  }

  upstream.accept();
  console.log('[WS] ElevenLabs Scribe v2 Realtime connected ✅');

  // Now accept the client WebSocket
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  console.log('[WS] Client WebSocket accepted');

  // Pure pass-through: the app sends correctly-formatted Scribe v2 Realtime
  // messages — no transformation needed in the Worker.
  server.addEventListener('message', (event) => {
    try {
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data) as Record<string, unknown>;
          console.log(
            '[WS] → ElevenLabs message_type:', msg.message_type,
            '| audio_base_64 length:', typeof msg.audio_base_64 === 'string' ? msg.audio_base_64.length : 0,
            '| commit:', msg.commit
          );
        } catch { /* non-JSON, forward anyway */ }
      }
      upstream.send(event.data);
    } catch (e) {
      console.error('[WS] upstream.send failed:', e);
    }
  });

  server.addEventListener('close', () => {
    console.log('[WS] Client disconnected');
    try { upstream.close(1000, 'Client disconnected'); } catch { /* already closed */ }
  });

  // ElevenLabs → app: forward transcript responses directly.
  // Log the *first* message in full so we can see whether ElevenLabs
  // echoed the keyterms back in session_started.config (per docs).
  let firstUpstreamMessage = true;
  upstream.addEventListener('message', (event: MessageEvent) => {
    try {
      if (typeof event.data === 'string') {
        if (firstUpstreamMessage) {
          firstUpstreamMessage = false;
          console.log('[WS] ElevenLabs FIRST message (full):', event.data);
        } else {
          console.log('[WS] ElevenLabs →', event.data.slice(0, 120));
        }
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
  const sig = await hmacSHA256(payload, env.TOKEN_SECRET);
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
  const expectedSig = await hmacSHA256(payload, env.TOKEN_SECRET);
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
