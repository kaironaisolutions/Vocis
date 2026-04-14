/**
 * Vocis STT Proxy — Cloudflare Worker
 *
 * Purpose: Keeps the ElevenLabs API key server-side so it never reaches
 * the mobile app. The app requests a short-lived session token, then
 * connects to this Worker's WebSocket endpoint which proxies audio
 * to ElevenLabs.
 *
 * Flow:
 * 1. App → POST /token (with device ID) → Worker returns session token
 * 2. App → WSS /stream?token=xxx → Worker validates token, opens
 *    upstream WebSocket to ElevenLabs with the real API key
 * 3. Audio/transcripts are relayed bidirectionally
 * 4. Worker enforces per-device rate limits
 *
 * Deploy:
 *   cd worker
 *   npm install
 *   wrangler secret put ELEVENLABS_API_KEY
 *   wrangler deploy
 */

interface Env {
  ELEVENLABS_API_KEY: string;
  RATE_LIMIT_HOURLY: string;
  RATE_LIMIT_DAILY: string;
  TOKEN_TTL_SECONDS: string;
}

// In-memory token store (resets on worker restart, which is fine for short-lived tokens)
const activeSessions = new Map<string, SessionInfo>();

interface SessionInfo {
  deviceId: string;
  createdAt: number;
  expiresAt: number;
}

// Per-device rate tracking (in-memory — resets on cold start, but workers are long-lived)
const deviceUsage = new Map<string, { hourly: number[]; daily: { date: string; count: number } }>();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS headers for mobile app
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
    }

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', sessions: activeSessions.size }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};

/**
 * POST /token — Issue a short-lived session token.
 * Requires X-Device-ID header for per-device rate limiting.
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

  // Validate device ID format (alphanumeric + hyphens only)
  if (!/^[a-zA-Z0-9\-_]+$/.test(deviceId)) {
    return jsonResponse({ error: 'Invalid device ID format.' }, 400, corsHeaders);
  }

  // Check rate limits
  const rateCheck = checkRateLimit(deviceId, env);
  if (!rateCheck.allowed) {
    return jsonResponse({ error: rateCheck.reason }, 429, corsHeaders);
  }

  // Generate session token
  const token = generateToken();
  const ttl = parseInt(env.TOKEN_TTL_SECONDS || '300', 10);
  const now = Date.now();

  activeSessions.set(token, {
    deviceId,
    createdAt: now,
    expiresAt: now + ttl * 1000,
  });

  // Record usage
  recordUsage(deviceId);

  // Cleanup expired sessions
  cleanupExpiredSessions();

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
 * Validates the session token, then relays audio/transcripts bidirectionally.
 */
async function handleWebSocket(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) {
    return new Response('Missing token parameter.', { status: 401 });
  }

  // Validate token
  const session = activeSessions.get(token);
  if (!session) {
    return new Response('Invalid or expired token.', { status: 401 });
  }

  if (Date.now() > session.expiresAt) {
    activeSessions.delete(token);
    return new Response('Token expired.', { status: 401 });
  }

  // Consume token (one-time use)
  activeSessions.delete(token);

  // Create WebSocket pair for the client
  const [client, server] = Object.values(new WebSocketPair());

  // Connect upstream to ElevenLabs with the real API key
  const upstreamUrl = `wss://api.elevenlabs.io/v1/speech-to-text/stream?api_key=${env.ELEVENLABS_API_KEY}`;

  // Accept the client connection
  server.accept();

  // Set up upstream connection
  const upstream = new WebSocket(upstreamUrl);

  // Track connection state
  let upstreamReady = false;
  const pendingMessages: string[] = [];

  // Relay: client → upstream
  server.addEventListener('message', (event) => {
    if (upstreamReady) {
      upstream.send(typeof event.data === 'string' ? event.data : '');
    } else {
      // Queue messages until upstream is ready
      if (typeof event.data === 'string') {
        pendingMessages.push(event.data);
      }
    }
  });

  server.addEventListener('close', () => {
    upstream.close(1000, 'Client disconnected');
  });

  // Relay: upstream → client
  upstream.addEventListener('open', () => {
    upstreamReady = true;
    // Flush queued messages
    for (const msg of pendingMessages) {
      upstream.send(msg);
    }
    pendingMessages.length = 0;
  });

  upstream.addEventListener('message', (event: MessageEvent) => {
    try {
      server.send(typeof event.data === 'string' ? event.data : '');
    } catch {
      // Client may have disconnected
    }
  });

  upstream.addEventListener('close', () => {
    try {
      server.close(1000, 'Upstream closed');
    } catch {
      // Already closed
    }
  });

  upstream.addEventListener('error', () => {
    try {
      server.close(1011, 'Upstream error');
    } catch {
      // Already closed
    }
  });

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
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

  // Check hourly limit
  if (usage.hourly.length >= maxHourly) {
    return { allowed: false, reason: `Hourly limit (${maxHourly}) reached. Try again later.` };
  }

  // Check daily limit
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

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [token, session] of activeSessions) {
    if (now > session.expiresAt) {
      activeSessions.delete(token);
    }
  }

  // Also cleanup device usage older than 2 hours
  const twoHoursAgo = now - 2 * 60 * 60 * 1000;
  for (const [deviceId, usage] of deviceUsage) {
    usage.hourly = usage.hourly.filter((t) => t > twoHoursAgo);
    if (usage.hourly.length === 0 && usage.daily.count === 0) {
      deviceUsage.delete(deviceId);
    }
  }
}

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
