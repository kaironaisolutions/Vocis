# Vocis — Project Status

**Updated:** June 4, 2026
**Stage:** Functional beta on the web, App Store launch in flight

---

## What it does

Vocis turns spoken words into a structured resale inventory. A vintage reseller holds their phone, says *"Medium 90s Polo Bomber, seventy-five dollars,"* and Vocis transcribes the speech, picks out the size, decade, name, and price, and saves the item to a session. Sessions export to three formats: Custom Excel, Shopify product import, and eBay/Depop listing CSV.

The problem it solves: manual inventory entry is the slowest step in reselling. Vocis turns that step into a hands-free dictation.

---

## What works today

- **Live transcription** — words appear as the reseller speaks, with no lag
- **Order-independent parsing** — these all save the same row:
  - *"Medium 90s hoodie, 300 dollars"*
  - *"300 dollars, medium, 90s hoodie"*
  - *"Hoodie, medium, 90s, 300 dollars"*
- **Multi-item dictation** — *"Medium 90s hoodie 75 dollars, large Nike tee 50 dollars"* saves both items in one breath
- **Pause-to-commit** — 2.5 seconds of silence auto-saves the current item; the user keeps going to the next one without tapping anything
- **Session review screen** — every saved item is editable before export
- **Three export formats** — Custom Excel, Shopify product CSV, eBay/Depop CSV
- **Encrypted at rest** — all inventory stored on device is encrypted
- **Biometric-gated export** — Face ID / Touch ID required before any file leaves the device

---

## Recent improvements (June 4 release)

| Before | After |
|---|---|
| *"Medium 90s hoodie, 300 dollars"* saved a row with no name | All four fields captured correctly |
| *"Extra large 70s Polo bomber, 200 dollars"* saved with no name and no decade | Saves cleanly as XL, 70's, Polo Bomber, $200 |
| *"300 dollars, medium 90s hoodie"* saved with $0 price | Price now preserved when the user leads with it |
| Items occasionally saved with the previous item's name | Each item now saves with its own correct name |

Net effect: the parser handles natural, unscripted speech — not just the rehearsed *"size, decade, name, price"* order. This is what makes the app feel hands-free in practice.

---

## Security posture

| Concern | Status |
|---|---|
| Speech-to-text vendor's API key on user's device | **No** — key lives only on our Cloudflare server |
| All network traffic encrypted | **Yes** — TLS 1.2+ enforced |
| Data at rest on device | **Encrypted** (SQLCipher) |
| Export requires user identity check | **Yes** — biometric |
| Auto-delete old sessions | **Yes** — default 90 days, configurable |
| Compromised device detection | **Yes** — alerts user on launch |

---

## What's left before App Store launch

1. **Native iOS / Android build** — today's app runs in a phone browser; the App Store version is a native build of the same code (~1–2 weeks)
2. **TestFlight beta** — 5–10 friendly resellers run the native build end-to-end (~2–3 weeks)
3. **Final certs & screenshots** — Apple Developer account + store listing assets (~3 days)
4. **Apple/Google review** — typically 3–7 days each

**Realistic launch window:** 4–6 weeks (early-to-mid July 2026), assuming TestFlight surfaces no major blockers.

---

## What it looks like to use right now

A reseller opens a URL on their phone, taps Start, and starts talking. Items appear on screen as they speak. After ~2.5 seconds of silence, the item auto-saves with a chime and the screen is ready for the next one. When they're done, they tap End Session and land on a review screen where they can edit anything before exporting to email or a file.

Suitable today for: a friendly private beta with a handful of resellers we trust.
Not yet: public download from the App Store.
