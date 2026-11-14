# SlipCheck — know what you actually got paid, and which agent takes more

Hundreds of millions of small farmers sell their produce through commission agents. What they get back is a paper settlement slip: what was sold, what was deducted, what is left. SlipCheck reads that slip **on the device** and checks the arithmetic, so a farmer can see what they really received and which line does not add up. It works with no connection.

Built for **#BuildHybridAI 2026** (Firebase AI Logic, web).

## How it works — "The model reads. The math decides."

| Step | Where | What |
|---|---|---|
| 1. Read the slip | **On-device** — Gemini Nano in Chrome, through Firebase AI Logic (`InferenceMode.ONLY_ON_DEVICE`) | The model only transcribes every row and amount as text, in any language. The photo stays on the device. |
| 2. Reconcile | On-device, plain JavaScript (`reconcile.js`) | Code decides which line is the total, the deductions and the net, using arithmetic, not labels: qty × price = amount, total − deductions = net, stated % vs. charged %. Small models misplace lines; arithmetic does not. |
| 3. Explain | **Cloud** (Firebase AI Logic, `ONLY_IN_CLOUD`), only when online and only when the user taps | Only the line names are sent — no photo, no amounts. The model returns plain words in the user's language; every number on screen is still written by code. |

If there is no connection, the result is saved on the device (IndexedDB) and the explanation runs as soon as the connection is back.

### When does a slip go to the cloud? Only with the user's OK — and only if the math needs it

A settlement slip is a financial document, so SlipCheck does **not** use `PREFER_ON_DEVICE` for reading (it would fall back to the cloud silently). The reconciliation engine decides when the cloud is worth asking:

| Situation | What SlipCheck does |
|---|---|
| On-device model available, reading reconciles | Show the result. Nothing leaves the device. |
| On-device reading does not reconcile (read twice) | Show **no number**, offer "Read it in the cloud instead" → consent → `ONLY_IN_CLOUD` read → **the same arithmetic checks** must pass. |
| No on-device model (e.g. most phones and other browsers today) | Ask first, then read with `ONLY_IN_CLOUD`; same checks. |
| Photo measured too blurry or dark | Never sent anywhere; ask for a retake. A cloud model can invent numbers that still add up, so an unclear photo is not "fixed" by a bigger model. |
| Explain (any time, online) | Only the line names are sent — never the photo or the amounts. |

On-device reading needs desktop Chrome with Gemini Nano (Chrome's built-in model; check `chrome://on-device-internals`). That makes the private, offline path a fit for a farmers' group or market office laptop that checks members' slips; on a phone the same app works through the consented cloud path.

Two ways to use it: on a **farmers' group or market office PC** with Chrome's on-device model, everything stays on the PC and works offline; on a **farmer's own phone**, SlipCheck asks before reading a slip in the cloud.

More, all on the device:
- **Check the photo first.** Sideways text makes a small model invent a different slip whose numbers still add up, so SlipCheck detects a sideways photo from its table lines, turns it, and asks for one tap before reading.
- **It never accuses on a slip it could not verify.** If the lines and the printed totals cannot be reconciled, it reads once more; if it still cannot, it asks for a new photo instead of showing a number.
- **Season ledger: which agent takes more.** Every verified slip is added up: how much deductions took this season, by line, and the share of the sale each agent deducted.
- **Read it to me.** The result is spoken in the farmer's language with the device's own voice. The sentences are built by code from the verified numbers.
- **In the farmer's language.** Screens and read-aloud in English, 한국어, Español and हिन्दी (phone language by default, changeable in Settings). Labels on the slip stay as printed.

SlipCheck checks arithmetic. It does not judge whether a fee is fair.

## Firebase products used
- **Firebase AI Logic** — hybrid on-device (Gemini Nano) + cloud (Gemini Developer API)
- **App Check** — reCAPTCHA Enterprise (Fraud Defense) on the hosted site, debug provider on localhost
- **Firebase Hosting**

## Run locally
Requirements: desktop Chrome with the on-device model available (`chrome://on-device-internals`).

```bash
python -m http.server 8765 --bind 127.0.0.1
# open http://127.0.0.1:8765/ in Chrome
```

On localhost the App Check debug provider prints a token in the console. Register it in the Firebase console (App Check → Apps → Manage debug tokens). Never commit it.

Tests (pure JavaScript, no browser needed):

```bash
node test/run.mjs           # reconciliation on real model outputs (44 checks)
node test/ledger_speak.mjs  # season ledger and read-aloud sentences (17 checks)
```

## Sample slips
All slips under `samples/` and `test/photo/` are **fictional**: invented names and numbers, made for this demo.

## License
Apache-2.0 — see [LICENSE](LICENSE).
