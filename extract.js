// SlipCheck — extraction adapters. The model only transcribes; reconcile.js decides.
// Reading goes through Firebase AI Logic (firebase.js): ONLY_ON_DEVICE by default, ONLY_IN_CLOUD with consent.

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
  'issuer: the name of the agent or market company printed at the top, if any. ' +
  'If a value is not clearly legible, return an empty string for it. Never guess or invent a number. Return JSON only.';

/** 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported'
 * A capability check only (is there an on-device model?). No inference happens here; every model call goes
 * through Firebase AI Logic (firebase.js). */
export async function onDeviceStatus() {
  if (!('LanguageModel' in self)) return 'unsupported';
  try { return await LanguageModel.availability({ expectedInputs: [{ type: 'image' }] }); }
  catch (_) { return 'unavailable'; }
}

/**
 * Read a slip through Firebase AI Logic. where = 'device' (default, never leaves the device) or 'cloud'
 * (only after the user agreed). All AI goes through the Firebase AI Logic SDK; nothing calls the model directly.
 */
export async function extractSlip(blob, opts) {
  const fb = await import('./firebase.js');
  return fb.extractViaFirebase(blob, opts);
}
