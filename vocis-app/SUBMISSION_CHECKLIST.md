# Vocis — App Store Submission Checklist

## Prerequisites

### 1. Account Setup
- [ ] Apple Developer account ($99/year) — developer.apple.com
- [ ] Google Play Developer account ($25 one-time) — play.google.com/console
- [ ] Expo account — expo.dev (free)
- [ ] Sentry account — sentry.io (free tier)

### 2. EAS Configuration
- [ ] Run `npx eas login` to authenticate
- [ ] Run `npx eas build:configure` to link project
- [ ] Replace `EAS_PROJECT_ID_HERE` in `app.json` with actual project ID
- [ ] Replace `EXPO_OWNER_HERE` in `app.json` with Expo username
- [ ] Replace `SENTRY_ORG_HERE` in `app.json` with Sentry org slug

### 3. Secrets (set via `eas secret:create`)
- [ ] `EXPO_PUBLIC_SENTRY_DSN` — Sentry DSN for crash reporting
- [ ] Apple credentials configured via `eas credentials`
- [ ] Google Play service account JSON uploaded

---

## Pre-Submission

### 4. Legal Documents (REQUIRED — submission will be rejected without these)
- [ ] Privacy Policy hosted at `vocisapp.com/privacy`
- [ ] Terms of Service hosted at `vocisapp.com/terms`
- [ ] Support URL live at `vocisapp.com/support`

### 5. Security Audit
- [ ] Run `npm audit` — must return 0 vulnerabilities
- [ ] Run `npm run test` — all 52 tests pass
- [ ] Verify no API keys in source code: `grep -r "sk_" src/`
- [ ] Verify `.gitignore` covers `.env`, credentials files
- [ ] Test API key extraction on debug APK (apktool / strings)
- [ ] Verify no audio files written to device storage (file system inspection)

### 6. Assets
- [ ] App icon (1024x1024 PNG, no transparency for iOS)
- [ ] Adaptive icon foreground (432x432 PNG)
- [ ] Splash screen (1284x2778 PNG)
- [ ] Screenshots — NO copyrighted brand imagery
  - [ ] iPhone 6.7" (1290x2796) — at least 3
  - [ ] iPhone 6.5" (1284x2778) — at least 3
  - [ ] iPad 12.9" (2048x2732) — at least 3
  - [ ] Android phone (1080x1920+) — at least 3
- [ ] Feature graphic for Google Play (1024x500)

---

## Build & Test

### 7. Development Build
```bash
npx eas build --profile development --platform all
```

### 8. Preview Build (internal testing)
```bash
npx eas build --profile preview --platform all
```
- [ ] Install on iPhone 13, iPhone 16, iPad
- [ ] Install on Pixel 7, Samsung S24
- [ ] Test full flow: record → preview → confirm → export CSV
- [ ] Test all 3 CSV formats (Custom, Shopify, eBay)
- [ ] Test all 3 delivery methods (email, download, share)
- [ ] Test noise environment (60-75 dB ambient)
- [ ] Test VoiceOver (iOS) full navigation
- [ ] Test TalkBack (Android) full navigation
- [ ] Test settings: API key set/remove, auto-purge toggle, export PIN
- [ ] Test session management: edit, delete, delete all
- [ ] Test edge cases: empty session, very long item name, $0 price

### 9. Production Build
```bash
npx eas build --profile production --platform all
```

---

## Submission

### 10. Apple App Store (TestFlight → Review)
```bash
npx eas submit --platform ios --profile production
```

**App Store Connect fields:**
- App Name: `Vocis — Voice Inventory Logger`
- Subtitle: `Log vintage items hands-free`
- Category: `Business` (primary), `Productivity` (secondary)
- Keywords: `inventory, vintage, voice, CSV, resale, thrift, Shopify, eBay, Depop`
- Age Rating: `4+`
- Privacy Policy URL: `https://vocisapp.com/privacy`
- Support URL: `https://vocisapp.com/support`

**Privacy questionnaire:**
- Data linked to the user: None
- Data used to track the user: None
- Data collected: None

### 11. Google Play Store (Internal → Review)
```bash
npx eas submit --platform android --profile production
```

**Play Console fields:**
- App Name: `Vocis — Voice Inventory Logger`
- Short description: `Log vintage inventory by voice. Export to CSV, Shopify, eBay.`
- Category: `Business`
- Content rating: `Everyone`
- Privacy Policy URL: `https://vocisapp.com/privacy`
- Target audience: `18+` (business tool)

---

## Post-Submission

### 12. Monitoring
- [ ] Monitor Sentry for crash reports
- [ ] Monitor ElevenLabs dashboard for API usage/billing
- [ ] Respond to App Store / Play Store review feedback
- [ ] Set up billing alerts in ElevenLabs dashboard

### 13. Trademark (from design doc)
- [ ] USPTO trademark search for "Vocis"
- [ ] Audit all app assets for originality
- [ ] Review ElevenLabs API ToS for attribution requirements
