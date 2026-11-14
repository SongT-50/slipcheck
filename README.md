# SlipCheck — know what you actually got paid, even with no signal

Hundreds of millions of small farmers sell their produce through commission agents. What they get back is a paper settlement slip: what was sold, what was deducted, what is left. SlipCheck reads that slip **on the device** and checks the arithmetic, so a farmer can see what they really received and which line does not add up. It works with no connection.

Built for **#BuildHybridAI 2026** (Firebase AI Logic, web).

## How it works — "The model reads. The math decides."

| Step | Where | What |
|---|---|---|
| 1. Read the slip | **On-device** — Gemini Nano in Chrome, through Firebase AI Logic (`InferenceMode.PREFER_ON_DEVICE`) | The model only transcribes every row and amount as text, in any language. The photo never leaves the device. |
| 2. Reconcile | On-device, plain JavaScript (`reconcile.js`) | Code decides which line is the total, the deductions and the net, using arithmetic, not labels: qty × price = amount, total − deductions = net, stated % vs. charged %. Small models misplace lines; arithmetic does not. |
| 3. Explain | **Cloud** (Firebase AI Logic, `ONLY_IN_CLOUD`), only when online and only when the user taps | Only the line names are sent — no photo, no amounts. The model returns plain words in the user's language; every number on screen is still written by code. |

If there is no connection, the result is saved on the device (IndexedDB) and the explanation waits until the user is back online.

More, all on the device:
- **Check the photo first.** Sideways text makes a small model invent a different slip whose numbers still add up, so SlipCheck detects a sideways photo from its table lines, turns it, and asks for one tap before reading.
- **It never accuses on a slip it could not verify.** If the lines and the printed totals cannot be reconciled, it reads once more; if it still cannot, it asks for a new photo instead of showing a number.
- **Season ledger.** Every verified slip is added up: how much deductions took this season, by line and by agent.
- **Read it to me.** The result is spoken in the farmer's language with the device's own voice. The sentences are built by code from the verified numbers.

SlipCheck checks arithmetic. It does not judge whether a fee is fair.

## Firebase products used
- **Firebase AI Logic** — hybrid on-device (Gemini Nano) + cloud (Gemini Developer API)
- **App Check** — reCAPTCHA v3 on the hosted site, debug provider on localhost
- **Firebase Hosting**

## Run locally
Requirements: desktop Chrome with the on-device model available (`chrome://on-device-internals`).

```bash
cd app
python -m http.server 8765 --bind 127.0.0.1
# open http://127.0.0.1:8765/ in Chrome
```

On localhost the App Check debug provider prints a token in the console. Register it in the Firebase console (App Check → Apps → Manage debug tokens). Never commit it.

Tests for the reconciliation logic:

```bash
node test/run.mjs
```

## Sample slips
All slips under `samples/` and `test/photo/` are **fictional**: invented names and numbers, made for this demo.

## License
Apache-2.0 — see [LICENSE](LICENSE).
