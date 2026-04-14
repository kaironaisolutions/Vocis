# Vocis — Agent Guide

## What This App Does

Vocis is a voice-to-inventory mobile app for vintage resellers. The user holds their iPhone and speaks items out loud ("Medium, nineties, Polo Red Quilted Bomber, seventy-five dollars"). The app transcribes speech in real-time via ElevenLabs Scribe v2, parses size/decade/name/price, and saves structured records to an encrypted SQLite database. Sessions are exported as CSV files in three formats: Custom Excel, Shopify import, and eBay/Depop.

---

## File Map

```
vocis-app/
├── app/
│   ├── _layout.tsx              Root navigator. Initialises Sentry, auto-purge, security check.
│   ├── index.tsx                Home screen — session list, delete, start recording.
│   ├── record.tsx               Recording screen — mic button, live transcript, item preview.
│   ├── export.tsx               Export screen — format picker + delivery method.
│   ├── session/[id].tsx         Session review — item list, edit, delete, export button.
│   ├── settings.tsx             API key, auto-purge, biometric export lock, delete all.
│   └── legal/
│       ├── licenses.tsx         Open source license list.
│       ├── privacy.tsx          Privacy policy (GDPR/CCPA compliant).
│       └── terms.tsx            Terms of service.
├── src/
│   ├── services/
│   │   ├── elevenLabsSTT.ts     WebSocket STT client. Rate limiting (persistent). Token auth.
│   │   ├── sttProxy.ts          Requests session tokens from Cloudflare Worker.
│   │   ├── secureStorage.ts     iOS Keychain / Android Keystore. API key + DB key storage.
│   │   ├── voiceParser.ts       Parses spoken text → { size, decade, item_name, price }.
│   │   ├── csvGenerator.ts      Generates CSV in 3 formats via PapaParse. CSV injection safe.
│   │   ├── exportDelivery.ts    Writes CSV to temp file → email / share / save-to-Files.
│   │   ├── exportSecurity.ts    Biometric auth before export. Unencrypted channel warnings.
│   │   ├── validation.ts        Validates + sanitises all fields before DB write.
│   │   ├── deviceSecurity.ts    Jailbreak/root detection via file path checks.
│   │   ├── appSettings.ts       AsyncStorage settings (auto-purge, export PIN).
│   │   └── crashReporting.ts    Sentry v8 with PII scrubbing. DSN from env var only.
│   ├── hooks/
│   │   ├── useRecording.ts      expo-av recording + ElevenLabsSTTService pipeline.
│   │   ├── useAutoPurge.ts      Auto-purge old sessions once per day on launch.
│   │   └── useDeviceSecurityCheck.ts  Jailbreak/root alert on launch.
│   ├── db/
│   │   ├── database.ts          expo-sqlite v16 + SQLCipher encryption. CRUD for sessions/items.
│   │   └── database.web.ts      In-memory DB for web/testing. No persistence.
│   ├── components/
│   │   ├── Button.tsx           Styled touchable. Variants: primary/secondary/outline/danger.
│   │   ├── Card.tsx             Surface container with border + shadow.
│   │   ├── ItemPreviewCard.tsx  Editable item card — inline edit for size/decade/name/price.
│   │   └── WaveformIndicator.tsx  Animated bars — active state uses native driver.
│   ├── constants/
│   │   └── theme.ts             Colors, Typography, Spacing, BorderRadius, Shadows.
│   └── types/
│       └── index.ts             InventoryItem, Session, ExportFormat, SIZE_MAP, DECADE_MAP.
├── worker/
│   └── src/index.ts             Cloudflare Worker. Token issue, WSS proxy, rate limiting.
├── app.json                     Expo config. Plugins, permissions, bundle IDs.
├── eas.json                     EAS build profiles: development / preview / production.
├── package.json                 Dependencies (expo ~54, RN 0.81.5, Sentry v8).
└── SUBMISSION_CHECKLIST.md      Pre-submission steps for App Store / Play Store.
```

---

## Architecture

### Audio Pipeline
```
iPhone mic → expo-av Audio.Recording (PCM 16kHz mono)
    → useRecording hook (250ms interval reads buffer)
    → ElevenLabsSTTService.sendAudio(base64)
    → WebSocket → Cloudflare Worker /stream
    → ElevenLabs Scribe v2 WSS
    → transcript events back through WS
    → voiceParser.parseTranscription()
    → InventoryItem (pending or auto-confirmed)
```

### Data Pipeline
```
transcript text
    → voiceParser.splitMultipleItems()        split continuous speech
    → voiceParser.parseTranscription()        extract size/decade/name/price
    → validation.validateItem()               block invalid, warn on edge cases
    → validation.sanitizeField()              strip control chars
    → database.addItem()                      write to encrypted SQLite
```

### Export Pipeline
```
SQLite session
    → database.getSessionItems()
    → csvGenerator.generateCSV(items, format)   PapaParse, CSV-injection safe
    → exportDelivery.deliverCSV()
        → expo-file-system File (temp write)
        → expo-mail-composer  (email)
        → expo-sharing        (share sheet)
        → Paths.document      (save to Files app)
```

---

## iOS Rules — Never Break

| BANNED | USE INSTEAD |
|--------|-------------|
| `window.*` (non-WS) | React Native globals / `Platform` checks |
| `document.*` | React Native components |
| `localStorage` / `sessionStorage` | `expo-secure-store` or `expo-sqlite` |
| `navigator.mediaDevices.getUserMedia` | `expo-av Audio.Recording.createAsync()` |
| `new AudioContext()` | `expo-av` |
| `MediaRecorder` | `expo-av Audio.Recording` |
| `new Blob([...])` + file save | `expo-file-system` `File.write()` |
| `URL.createObjectURL()` | `expo-file-system` URI string |
| `<a download=...>` in JSX | `expo-sharing shareAsync()` |
| `window.confirm()` | `Alert.alert()` |
| Direct `fetch()` to ElevenLabs | Must go through `sttProxy.ts` |

Web Speech API (`SpeechRecognition`) is used in `record.tsx` but gated behind `Platform.OS === 'web'` — do not remove the gate.

---

## Running Locally

```bash
cd vocis-app
npm install
npx expo start --tunnel   # generates exp:// URL for Expo Go / dev client
```

> **This app requires a dev build** — it cannot run in Expo Go because:
> - `expo-sqlite` with `useSQLCipher: true` requires native compilation
> - `expo-local-authentication` requires native biometrics module
> - `@sentry/react-native` v8 requires native crash reporting module

---

## Build Commands

```bash
# Dev build (physical iPhone, development client)
eas build --platform ios --profile development

# Internal TestFlight
eas build --platform ios --profile preview

# App Store production
eas build --platform ios --profile production

# Submit to App Store
eas submit --platform ios
```

---

## ElevenLabs Integration

- **API key is NEVER in the app** — stored in Cloudflare Worker secrets only
- All STT requests go through `sttProxy.ts` → Cloudflare Worker
- Worker URL: `https://vocis-stt-proxy.kaironai.workers.dev`
- Worker handles: authentication, rate limiting, CORS, token issuance
- Flow:
  1. App `POST /token` with `X-Device-ID` header
  2. Worker checks rate limits, issues short-lived token (5 min, one-time use)
  3. App connects `WSS /stream?token=xxx`
  4. Worker validates token, opens upstream WSS to ElevenLabs with real API key
  5. Audio relayed bidirectionally
- Rate limits: 20 sessions/hour, 120 sessions/day per device (both app-side and worker-side)
- To update secrets: `cd worker && wrangler secret put ELEVENLABS_API_KEY`

---

## Database Encryption

- `expo-sqlite` v16 with `useSQLCipher: true` in `app.json` plugin config
- 32-byte random key generated via `expo-crypto.getRandomBytesAsync(32)` on first launch
- Key stored in iOS Keychain (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`) via `expo-secure-store`
- Key in: `SecureStore` key `vocis_db_key_v1`
- Encryption applied via `PRAGMA key = '...'` immediately after `openDatabaseAsync()`
- Web platform skips encryption (in-memory DB used for web testing only)

---

## Security Status (PRD Section 7.5)

| Item | Status |
|------|--------|
| 1. SQLite encryption at rest (SQLCipher) | ✅ DONE — `useSQLCipher: true`, key from Keychain |
| 2. API key in Keychain/Keystore (never in bundle) | ✅ DONE — `expo-secure-store` |
| 3. ElevenLabs API key server-side only | ✅ DONE — Cloudflare Worker secret |
| 4. TLS 1.2+ for all network (WSS only) | ✅ DONE — WSS enforced, WS rejected |
| 5. Jailbreak/root detection | ✅ DONE — `deviceSecurity.ts` + launch alert |
| 6. Biometric auth before export | ✅ DONE — `exportSecurity.ts`, Face ID / Touch ID |
| 7. Auto-purge (default 90 days) | ✅ DONE — `useAutoPurge.ts`, configurable |
| 8. CSV injection prevention | ✅ DONE — `sanitizeCSVValue()` in csvGenerator |
| 9. Rate limiting (app + worker) | ✅ DONE — 20/hr, 120/day on both layers |

---

## Known Issues

1. **Audio streaming stub** (`useRecording.ts` lines 173–186): The 250ms interval reads recording status but does NOT actually read the audio buffer and send it to the WebSocket. The comment says "In a production build, we'd read the audio buffer directly." This means STT transcription will not work until native buffer reading is implemented. This requires using `expo-av`'s `onAudioSampleReceived` callback (available in EAS dev builds) to get PCM data, encode to base64, and call `sttService.sendAudio(base64)`.

2. **Certificate pinning** (`elevenLabsSTT.ts` line 11): The `ELEVENLABS_CERT_PINS` array is empty. Real cert pins for ElevenLabs need to be obtained and added before production.

3. **`Constants.installationId` deprecated** (`sttProxy.ts` line 21): `Constants.installationId` is deprecated in newer Expo versions. For production, use `expo-application`'s `Application.getAndroidId()` / `Application.applicationId` for a stable device ID.

---

## Next Steps (Ordered)

1. **Implement audio buffer streaming** in `useRecording.ts` — use `onAudioSampleReceived` from expo-av to get PCM data, encode to base64, send via `sttService.sendAudio()`. This is the most critical missing piece for the app to actually work.

2. **Build and install dev client** on physical iPhone: `eas build --platform ios --profile development`

3. **End-to-end test**: Record → parse → confirm → save → export CSV → verify all 3 formats.

4. **Add certificate pinning** for ElevenLabs endpoint (obtain SPKI hashes from ElevenLabs).

5. **Replace `Constants.installationId`** with `expo-application` stable device ID.

6. **Configure Sentry DSN**: Set `EXPO_PUBLIC_SENTRY_DSN` in EAS build secrets.

7. **Publish to TestFlight**: `eas build --platform ios --profile preview`

8. **App Store submission**: Configure Apple credentials in `eas.json` submit section, then `eas submit --platform ios`.
