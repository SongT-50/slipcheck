// SlipCheck — extraction adapters. The model only transcribes; reconcile.js decides.
// Adapter B (main): Firebase AI Logic hybrid (PREFER_ON_DEVICE) — firebase.js.
// Adapter A (safety net): Chrome built-in Prompt API called directly.

const S = { type: 'string' };
export const SCHEMA = {
  type: 'object',
  properties: {
    issuer: S,
    items: { type: 'array', items: { type: 'object', properties: { product: S, unit: S, qty: S, unit_price: S, amount: S }, required: ['product', 'qty', 'unit_price', 'amount'] } },
    gross: S,
    deductions: { type: 'array', items: { type: 'object', properties: { label: S, rate_pct: S, amount: S }, required: ['label', 'amount'] } },
    total_deductions: S,
    net: S,
  },
  required: ['items', 'gross', 'deductions', 'net'],
};

export const PROMPT =
  'This is a produce consignment sale settlement slip. It may be in any language. ' +
  'Copy every value exactly as printed, keeping commas and decimal points. Keep labels in the original language. ' +
  'List every item row and every deduction line (not the totals). If a deduction label shows a percentage, put it in rate_pct. ' +
  'issuer: the name of the agent or market company printed at the top, if any. Return JSON only.';

/** 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported' */
export async function onDeviceStatus() {
  if (!('LanguageModel' in self)) return 'unsupported';
  try { return await LanguageModel.availability({ expectedInputs: [{ type: 'image' }] }); }
  catch (_) { return 'unavailable'; }
}

/**
 * Adapter A: read a slip image on-device with Chrome's Prompt API.
 * Streams the answer; stops on runaway whitespace (seen with the Spanish slip) or on timeout,
 * and returns whatever was written so far — reconcile.js can salvage partial JSON.
 */
export async function extractOnDevice(blob, { onChunk = () => {}, timeoutMs = 90000 } = {}) {
  const bmp = await createImageBitmap(blob);
  const session = await LanguageModel.create({
    expectedInputs: [{ type: 'image' }, { type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
  });
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort('timeout'), timeoutMs);
  let text = '', stopped = null;
  try {
    const stream = session.promptStreaming(
      [{ role: 'user', content: [{ type: 'text', value: PROMPT }, { type: 'image', value: bmp }] }],
      { responseConstraint: SCHEMA, signal: ac.signal });
    for await (const chunk of stream) {
      text += chunk;
      onChunk(text);
      if (/\s{40,}$/.test(text)) { stopped = 'runaway'; ac.abort('runaway'); break; }
    }
  } catch (e) {
    stopped = stopped || (ac.signal.aborted ? String(ac.signal.reason) : String(e));
  } finally {
    clearTimeout(timer);
    session.destroy();
  }
  return { raw: text, stopped, via: 'chrome-prompt-api' };
}

/**
 * Main entry. Adapter B (Firebase AI Logic hybrid, see firebase.js) is used whenever its SDK loads.
 * Adapter A is only a safety net if the SDK cannot be loaded at all.
 */
export async function extractSlip(blob, opts) {
  let fb;
  try { fb = await import('./firebase.js'); }
  catch (e) { console.warn('Firebase SDK not loaded, using Prompt API directly:', e); }
  if (fb) return fb.extractViaFirebase(blob, opts);
  return extractOnDevice(blob, opts);
}
