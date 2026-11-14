// SlipCheck — the Android app's AI path. Same screens and the same math as the web app; only the model call
// changes: the Android app (android/) runs Firebase AI Logic for Android, with Gemini Nano on the phone through
// ML Kit / AICore (ONLY_ON_DEVICE) and the cloud model only after the user agrees (ONLY_IN_CLOUD).
// This file is loaded only inside that app, where the page can call window.SlipNative.

const pending = new Map();
let seq = 0;

// The app calls back into the page with (id, kind, payload): kind = 'chunk' | 'done' | 'error'.
self.__slipNative = (id, kind, payload) => {
  const p = pending.get(id);
  if (!p) return;
  if (kind === 'chunk') { p.onChunk(payload); return; }
  pending.delete(id);
  if (kind === 'done') p.resolve(payload); else p.reject(new Error(payload));
};

function call(method, args, onChunk = () => {}) {
  const id = String(++seq);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onChunk });
    self.SlipNative[method](id, ...args);
  });
}

/** 'available' | 'downloadable' | 'downloading' | 'unavailable' — as reported by FirebaseAIOnDevice.checkStatus(). */
export const status = () => call('status', []);

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

/** Same contract as firebase.js extractViaFirebase. */
export async function extractViaFirebase(blob, { onChunk = () => {}, timeoutMs = 120000, where = 'device' } = {}) {
  const { PROMPT } = await import('./extract.js');
  const data = await toJpegBase64(blob);
  let text = '', stopped = null, source = 'unknown';
  const timer = setTimeout(() => { stopped = 'timeout'; }, timeoutMs);
  try {
    const res = JSON.parse(await call('read', [data, where, PROMPT], (t) => { text = t; onChunk(t); }));
    text = res.text || text;
    source = res.source || source;
  } catch (e) {
    stopped = stopped || String(e?.message || e);
  } finally { clearTimeout(timer); }
  return { raw: text, stopped, via: 'firebase-ai-logic-android', source };
}

/** Same contract as firebase.js explainWords: words only, labels only. */
export async function explainWords(labels, lang = 'en') {
  const fb = await import('./explain-prompt.js');
  return JSON.parse(await call('explain', [fb.explainPrompt(labels, lang)]));
}

