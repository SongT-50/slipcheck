// SlipCheck — season ledger. Pure functions over the slips saved on this device; nothing is sent anywhere.
// Only slips that reconciled are counted: a slip we asked the farmer to retake must not move the totals.

/** "위탁수수료(7%)" / "Commission @ 6%" / "Comisión 10%" -> a grouping key that ignores rates and spacing. */
export function labelKey(label) {
  return String(label || '?').toLowerCase()
    .replace(/[@(（].*$/, '')            // drop "(7%)", "@ 6%"
    .replace(/\d+(?:[.,]\d+)?\s*%/g, '')
    .replace(/[^\p{L}]+/gu, '')          // letters only, any script
    || '?';
}

/** Agent / market company name -> grouping key ("Sample Krishi Traders, Shop 14" ~ "sample krishi traders"). */
export function issuerKey(name) {
  return String(name || '').toLowerCase().replace(/(shop|no\.?|núm\.?)\s*\d+.*$/i, '').replace(/[^\p{L}]+/gu, '') || '';
}

/** Edit distance, for names the model copied with one wrong character ("가나첨과" for "가나청과"). */
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
/** Same agent if the keys differ by at most one character per six (and the name is not tiny). */
export function sameIssuer(a, b) {
  if (a === b) return true;
  const n = Math.max(a.length, b.length);
  return n >= 4 && editDistance(a, b) <= Math.max(1, Math.floor(n / 6));
}

/**
 * @param {Array} rows   saved slips: { ts, currency, issuer?, result }
 * @param {string} currency  e.g. "KRW|₩" — only slips in this currency are added together
 */
export function buildLedger(rows, currency) {
  const ok = rows.filter((r) => r.currency === currency && r.result && !r.result.unreliable
    && Number.isFinite(r.result.gross) && r.result.gross > 0 && Number.isFinite(r.result.net));
  const L = { count: ok.length, skipped: rows.filter((r) => r.currency === currency).length - ok.length,
    gross: 0, deducted: 0, received: 0, flagged: 0, kg: 0, byLabel: [], byIssuer: [], slips: [] };
  const lab = new Map(), iss = new Map();
  for (const r of ok.sort((a, b) => a.ts - b.ts)) {
    const x = r.result;
    L.gross += x.gross; L.deducted += x.totalDeductions; L.received += x.net;
    const flagged = x.deductions.some((d) => d.rateOk === false);
    if (flagged) L.flagged++;
    const kg = (x.items || []).reduce((s, i) => s + (Number.isFinite(i.kg) ? i.kg : 0), 0);
    L.kg += kg;
    for (const d of x.deductions) {
      const k = labelKey(d.label);
      const e = lab.get(k) || { label: d.label, amount: 0, count: 0 };
      e.amount += d.amount; e.count++; lab.set(k, e);
    }
    let ik = issuerKey(r.issuer);
    if (ik) {
      for (const k of iss.keys()) if (sameIssuer(k, ik)) { ik = k; break; }
      const e = iss.get(ik) || { issuer: r.issuer, count: 0, gross: 0, deducted: 0, flagged: 0 };
      e.count++; e.gross += x.gross; e.deducted += x.totalDeductions; if (flagged) e.flagged++; iss.set(ik, e);
    }
    L.slips.push({ ts: r.ts, gross: x.gross, deducted: x.totalDeductions, share: x.totalDeductions / x.gross, flagged, issuer: r.issuer || '' });
  }
  L.share = L.gross ? L.deducted / L.gross : NaN;
  L.perKg = L.kg > 0 ? L.received / L.kg : null;
  L.byLabel = [...lab.values()].sort((a, b) => b.amount - a.amount);
  L.byIssuer = [...iss.values()].map((e) => ({ ...e, share: e.deducted / e.gross })).sort((a, b) => b.share - a.share);
  return L;
}
