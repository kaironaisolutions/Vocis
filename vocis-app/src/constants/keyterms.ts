/**
 * VOCIS_KEYTERMS — Domain-vocabulary reference (kept on the app side
 * for the user-extensible Settings UI and as an unstructured reference).
 *
 * NOTE: ElevenLabs keyterm biasing is NOT applied from this list at
 * runtime. Per the Scribe v2 Realtime spec, keyterms must be passed as
 * repeated `keyterms=` URL query parameters on the WebSocket connection
 * to ElevenLabs — that happens inside `worker/src/index.ts`
 * (PRIORITY_KEYTERMS), not from the app.
 *
 * To add a new keyterm that actually reaches ElevenLabs:
 *   1. Add it to PRIORITY_KEYTERMS in worker/src/index.ts
 *   2. Run: cd worker && npx wrangler deploy
 *
 * The ElevenLabs spec caps the per-session list at 50 entries, each
 * ≤20 chars; new entries should respect that.
 */
export const VOCIS_KEYTERMS: readonly string[] = [
  // ── HIGH FREQUENCY BRANDS (50+ items) ─────────────────────────────────────
  "Levi's", 'Levis',
  'Carhartt',
  'Ralph Lauren', 'Polo', 'Polo Ralph Lauren',
  'GAP',
  'Wrangler',
  'Eddie Bauer',
  'Harley', 'Harley Davidson',
  'Nike',
  'Nautica',
  'Tommy', 'Tommy Hilfiger',
  'Dickies',
  'Woolrich',
  'LL Bean', 'L.L. Bean',
  'Quiksilver',

  // ── MEDIUM FREQUENCY BRANDS (10–49 items) ─────────────────────────────────
  'Patagonia', 'North Face', 'Columbia',
  'Pendleton', 'Coogi', 'Guess', 'Lee',
  'Gotcha', 'Balenciaga', 'Banana Republic',
  'Members Only', 'Starter', 'Champion',
  'Russell Athletic', 'Jeff Hamilton',
  'Karl Kani', 'FUBU', 'Rocawear', 'Phat Farm',
  'Girbaud', 'Dior', 'YSL',
  'Lucky Brand', 'Orvis', 'Filson',
  'Lands End', 'Nascar', 'Paco',
  'Anne Klein', 'J Crew', 'G Valentino',
  'Saks Fifth', 'Mcgregor', 'Excelled',
  'Cole Haan', 'Georgetown', 'ACG',

  // ── GARMENT TYPES — top frequency (100+ occurrences) ──────────────────────
  'jacket', 'sweater', 'leather jacket',
  'denim jacket', 'shirt', 'tee', 'jeans',
  'knit', 'coat', 'crewneck', 'hat',
  'trucker', 'trucker jacket', 'vest',
  'bomber', 'chore coat', 'shorts', 'pants',

  // ── GARMENT TYPES — mid frequency (30–99 occurrences) ─────────────────────
  'windbreaker', 'harrington', 'barn coat',
  'cardigan', 'flannel', 'button up',
  'carpenters', 'carpenter pants', 'carpenter shorts',
  'fleece', 'blazer', 'pullover', 'puffer', 'jersey',
  'varsity jacket', 'biker jacket', 'chore shirt',
  'work jacket', 'flight jacket', 'rugby shirt',
  'track jacket', 'silk shirt', 'rayon shirt',
  'camo jacket', 'western shirt', 'golf shirt',
  'hooded jacket', 'reversible jacket',

  // ── SPECIALTY GARMENT TYPES ──────────────────────────────────────────────
  'denim trucker', 'blanket lined',
  'sherpa lined', 'leather bomber',
  'military coat', 'fatigue pants',
  'overalls', 'trousers', 'slacks',
  'corduroy slacks', 'bell bottom',
  'bootcut', 'quarter zip', 'half zip',
  'CPO shirt', 'chamois shirt',
  'safari jacket', 'safari vest',
  'linen shirt', 'cowichan',
  'double knee', 'cableknit',
  'colorblock', 'patchwork',
  'chore jacket', 'shacket',

  // ── MATERIALS & DESCRIPTORS ──────────────────────────────────────────────
  'leather', 'suede', 'wool', 'cotton',
  'denim', 'linen', 'silk', 'rayon',
  'corduroy', 'velour', 'sherpa', 'fleece',
  'cableknit', 'flannel', 'quilted',
  'striped', 'plaid', 'patterned', 'floral',
  'camo', 'embroidered', 'reversible',
  'argyle', 'paisley',

  // ── COLORS commonly found in inventory ───────────────────────────────────
  'olive', 'moss', 'butter', 'cream',
  'burgundy', 'teal', 'navy', 'charcoal',
  'mauve', 'rust', 'sage', 'forest',

  // ── PRICE WORDS ──────────────────────────────────────────────────────────
  'dollars', 'dollar', 'bucks',
];
