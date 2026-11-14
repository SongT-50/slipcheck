// SlipCheck — all AI through Firebase AI Logic, guarded by App Check.
// Reading: ONLY_ON_DEVICE (Gemini Nano; the photo stays on the device). The cloud reader (ONLY_IN_CLOUD) runs
// only after the user agrees: when this device has no on-device model, or its reading could not be verified.
// Explaining: ONLY_IN_CLOUD with line names only — never the photo or the amounts.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-app-check.js';
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-ai.js';
import { firebaseConfig, recaptchaSiteKey } from './firebase-config.js';
import { SCHEMA, PROMPT } from './extract.js';

const app = initializeApp(firebaseConfig);

// App Check. On localhost the SDK uses a debug token: it prints one to the console the first time,
// and it is registered by hand in the Firebase console. The token is never written into this repo.
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
if (LOCAL) self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
if (LOCAL || recaptchaSiteKey) {
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(recaptchaSiteKey || 'debug-only'),
    isTokenAutoRefreshEnabled: true,
  });
}

// On-device options are kept in one object; the SDK reads promptOptions on every call,
// so a fresh AbortSignal can be set per slip.
const onDeviceParams = {
  createOptions: {
    expectedInputs: [{ type: 'image' }, { type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
  },
  promptOptions: { responseConstraint: SCHEMA },
};

// Two readers over one Firebase AI Logic setup.
// A settlement slip is a financial document, so reading never falls back to the cloud silently
// (PREFER_ON_DEVICE would): the device reader is ONLY_ON_DEVICE, and the cloud reader runs only after the
// user agrees (no on-device model here, or the on-device read could not be verified).
const cloudParams = {
  model: 'gemini-3.5-flash-lite',
  generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0 },
};
const ai = getAI(app, { backend: new GoogleAIBackend() });
const READERS = {
  device: getGenerativeModel(ai, { mode: InferenceMode.ONLY_ON_DEVICE, onDeviceParams }),
  cloud: getGenerativeModel(ai, { mode: InferenceMode.ONLY_IN_CLOUD, inCloudParams: cloudParams }),
};

/** JPEG/PNG only on-device; also shrink big phone photos (faster on-device, smaller upload). */
async function toJpegBase64(blob, maxSide = 1600) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const out = await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  const buf = new Uint8Array(await out.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Read a slip through Firebase AI Logic. Streams; stops on runaway whitespace or timeout and
 * returns whatever was written — reconcile.js can salvage partial JSON.
 * @returns {{raw:string, stopped:string|null, via:'firebase-ai-logic', source:'on_device'|'in_cloud'|'unknown'}}
 */
export async function extractViaFirebase(blob, { onChunk = () => {}, timeoutMs = 120000, where = 'device' } = {}) {
  const model = READERS[where];
  const data = await toJpegBase64(blob);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort('timeout'), timeoutMs);
  onDeviceParams.promptOptions.signal = ac.signal;
  let text = '', stopped = null, source = 'unknown';
  try {
    const res = await model.generateContentStream(
      { contents: [{ role: 'user', parts: [{ text: PROMPT }, { inlineData: { mimeType: 'image/jpeg', data } }] }] },
      { signal: ac.signal, timeout: timeoutMs });
    for await (const chunk of res.stream) {
      if (chunk.inferenceSource) source = chunk.inferenceSource;
      text += chunk.text();
      onChunk(text);
      if (/\s{40,}$/.test(text)) { stopped = 'runaway'; ac.abort('runaway'); break; }
    }
    if (source === 'unknown') source = (await res.response.catch(() => ({}))).inferenceSource || 'unknown';
  } catch (e) {
    stopped = stopped || (ac.signal.aborted ? String(ac.signal.reason) : String(e?.message || e));
  } finally {
    clearTimeout(timer);
    delete onDeviceParams.promptOptions.signal;
  }
  return { raw: text, stopped, via: 'firebase-ai-logic', source };
}

// ---- Cloud step: explain the deductions in the user's language (only when online, only on tap) ----
// Same rule as reading: the model writes words only; every number on screen is written by code.
// Only the labels (never the photo, never the amounts) are sent.
const EXPLAIN_SCHEMA = {
  type: 'object',
  properties: {
    total_sale: { type: 'string' },     // "Total sale"
    you_received: { type: 'string' },   // "You received"
    share: { type: 'string' },          // "Your share of the sale"
    meanings: { type: 'array', items: { type: 'string' } }, // one per label, same order
    mismatch: { type: 'string' },       // sentence with {stated} {expected} {charged} placeholders
  },
  required: ['total_sale', 'you_received', 'share', 'meanings', 'mismatch'],
};
const explainer = getGenerativeModel(ai, {
  mode: InferenceMode.ONLY_IN_CLOUD,
  inCloudParams: { model: 'gemini-3.5-flash-lite',
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: EXPLAIN_SCHEMA } },
});

/** Ask the cloud model for words only. Returns the parsed JSON. */
export async function explainWords(labels, lang = 'en') {
  const prompt =
    `Language: BCP-47 "${lang}". A farmer is reading a produce consignment settlement slip. Write plain everyday words, speaking to the farmer as "you". ` +
    'total_sale, you_received, share: short labels (2-5 words) in that language. ' +
    'meanings: for each deduction label below, in the same order, a few words on what that kind of charge usually pays for. ' +
    'Do not repeat the label, do not mention amounts or percentages, do not say whether it is fair, legal or normal. ' +
    'mismatch: one or two sentences in that language that keep the placeholders {stated}, {expected} and {charged} exactly, meaning: ' +
    '"The slip says {stated}, which would be {expected} of your total sale, but {charged} was taken. Ask the company that issued the slip how it was calculated." ' +
    'Deduction labels: ' + JSON.stringify(labels);
  const res = await explainer.generateContent(prompt);
  return JSON.parse(res.response.text());
}
