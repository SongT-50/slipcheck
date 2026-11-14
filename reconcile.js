// SlipCheck reconcile engine — "The model reads. The math decides."
// The on-device model only transcribes amount lines. This module decides, by arithmetic,
// which line is the gross, the deduction subtotal and the net, and flags anything that does not add up.
// Works in the browser and in Node (ES module). No dependencies.

/** Parse a printed amount like "1,540,000", "11,100.00", "1.200,50", "Rs. 450", "7%". */
export function parseAmount(s, opts = {}) {
  if (s === null || s === undefined) return NaN;
  if (typeof s === 'number') return s;
  let t = String(s).trim();
  const neg = /^\(.*\)$/.test(t) || /^-/.test(t);
  t = t.replace(/[^\d.,]/g, '').replace(/^[.,]+|[.,]+$/g, ''); // "Rs. 450" -> "450"
  if (!t || !/\d/.test(t)) return NaN;
  const lc = t.lastIndexOf(','), ld = t.lastIndexOf('.');
  let dec = null;
  if (lc >= 0 && ld >= 0) dec = lc > ld ? ',' : '.';
  else if (lc >= 0) dec = /,\d{1,2}$/.test(t) && (t.match(/,/g).length === 1) ? ',' : null;
  else if (ld >= 0) {
    const many = t.match(/\./g).length > 1;
    dec = many ? null : (opts.decimal === ',' && /\.\d{3}$/.test(t) ? null : '.');
  }
  let n;
  if (dec === null) n = Number(t.replace(/[.,]/g, ''));
  else {
    const other = dec === ',' ? '.' : ',';
    n = Number(t.split(other).join('').replace(dec, '.'));
  }
  return neg ? -n : n;
}

/** Stated percentage from a rate field or from the label ("Commission @ 6%", "위탁수수료(7%)"). */
export function statedRate(rateField, label) {
  // A bare number in the rate field is trusted only if a % sign is printed somewhere on that line
  // (seen: the model put "36" for a 36,000 handling fee into rate_pct).
  const f = rateField === undefined || rateField === null ? '' : String(rateField).trim();
  const pctPrinted = f.includes('%') || String(label || '').includes('%');
  const fromField = f && pctPrinted ? parseAmount(f) : NaN;
  if (fromField > 0 && fromField < 50) return fromField;
  const m = String(label || '').match(/(\d+(?:[.,]\d+)?)\s*%/);
  return m ? parseAmount(m[1]) : NaN;
}

/** Turn raw model output into {items, gross, deductions, total_deductions, net}. Survives broken JSON. */
export function salvage(raw) {
  const text = String(raw || '').replace(/\s+$/, '');
  try {
    const j = JSON.parse(text);
    return { data: j, salvaged: false };
  } catch (_) { /* fall through */ }
  const fields = (chunk) => {
    const o = {};
    for (const m of chunk.matchAll(/"(\w+)"\s*:\s*"([^"}\]]*)/g)) if (!(m[1] in o)) o[m[1]] = m[2];
    return o;
  };
  const items = [...text.matchAll(/\{[^{}\[\]]*"product"[^{}\[\]]*/g)].map((m) => fields(m[0]));
  const deductions = [...text.matchAll(/\{[^{}\[\]]*"label"[^{}\[\]]*/g)].map((m) => fields(m[0]));
  const first = (k) => { const m = text.match(new RegExp(`"${k}"\\s*:\\s*"([^"}\\]]*)`)); return m ? m[1] : undefined; };
  const last = (k) => { const all = [...text.matchAll(new RegExp(`"${k}"\\s*:\\s*"([^"}\\]]*)`, 'g'))]; return all.length ? all[all.length - 1][1] : undefined; };
  return {
    data: { items, deductions, gross: first('gross'), total_deductions: last('total_deductions'), net: last('net') },
    salvaged: true,
  };
}

const near = (a, b, base) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.max(1, Math.abs(base || b) * 0.0005);

/** Main entry. `raw` = model output string (or an already-parsed object). */
export function reconcile(raw, opts = {}) {
  const { data, salvaged } = typeof raw === 'string' ? salvage(raw) : { data: raw, salvaged: false };
  const P = (x) => parseAmount(x, opts);
  const checks = [];
  const add = (id, ok, detail) => checks.push({ id, ok, detail });

  // 1) item rows: qty x unit price = amount (amount-only rows are totals/deductions put in the wrong list)
  const items = (data.items || []).filter((it) => {
    if (Number.isFinite(P(it.qty)) || Number.isFinite(P(it.unit_price))) return true;
    const v = P(it.amount);   // amount-only row: drop it only if it is really a total or a deduction
    const others = [P(data.gross), P(data.net), P(data.total_deductions), ...(data.deductions || []).map((d) => P(d.amount))];
    return !others.some((o) => near(o, v, v));
  }).map((it) => {
    const qty = P(it.qty), price = P(it.unit_price), amount = P(it.amount);
    const kgMatch = String(it.unit || '').match(/(\d+(?:[.,]\d+)?)\s*kg/i);
    const kgPerUnit = kgMatch ? parseAmount(kgMatch[1]) : NaN;
    const ok = near(qty * price, amount, amount);
    add('row:' + (it.product || '?'), ok, `${qty} x ${price} = ${qty * price} vs printed ${amount}`);
    return { product: it.product, unit: it.unit, qty, price, amount, kg: qty * kgPerUnit, rowOk: ok };
  });
  let itemSum = items.reduce((s, i) => s + (Number.isFinite(i.amount) ? i.amount : 0), 0);
  const grossPrinted = P(data.gross);

  // 1b) misread row repair: if the rows that fail qty x price, recomputed, make the items add up to the
  //     printed total, the amount was misread (seen: 11,100 copied as 6,000 from the next row).
  if (!near(grossPrinted, itemSum, itemSum)) {
    const bad = items.filter((i) => !i.rowOk && Number.isFinite(i.qty * i.price));
    const fixedSum = itemSum + bad.reduce((s, i) => s + i.qty * i.price - (Number.isFinite(i.amount) ? i.amount : 0), 0);
    if (bad.length && near(fixedSum, grossPrinted, grossPrinted)) {
      for (const i of bad) {
        const c = checks.find((x) => x.id === 'row:' + (i.product || '?'));
        if (c) c.detail = `read as ${i.amount}; ${i.qty} x ${i.price} = ${i.qty * i.price} matches the slip total — please look at the photo`;
        i.readAs = i.amount; i.amount = i.qty * i.price;
      }
      itemSum = fixedSum;
    }
  }

  // 2) gross: printed gross if it equals the item sum, otherwise the item sum
  const grossOk = near(grossPrinted, itemSum, itemSum);
  add('gross', grossOk, `items add up to ${itemSum}, printed ${grossPrinted}`);
  const gross = items.length ? itemSum : grossPrinted;

  // 3) classify deduction lines by arithmetic, not by label (language-agnostic)
  const regular = [], subtotals = [], netLines = [];
  let sum = 0;
  for (const d of data.deductions || []) {
    const v = P(d.amount);
    if (!Number.isFinite(v)) continue;
    if (regular.length >= 2 && near(v, sum, sum)) { subtotals.push(v); continue; }
    if (regular.length >= 1 && near(v, gross - sum, gross)) { netLines.push(v); continue; }
    if (near(v, gross, gross)) continue; // gross repeated
    if (v === 0) continue;
    const rate = statedRate(d.rate_pct, d.label);
    const actual = gross ? (100 * v) / gross : NaN;
    let rateOk = null;
    if (Number.isFinite(rate) && rate > 0) {
      const expected = (gross * rate) / 100;
      rateOk = Math.abs(v - expected) <= Math.max(1, expected * 0.005);
      add('rate:' + d.label, rateOk, `stated ${rate}% -> expected ${expected.toFixed(2)}, charged ${v} (= ${actual.toFixed(2)}%)`);
    }
    regular.push({ label: d.label, amount: v, statedRate: Number.isFinite(rate) && rate > 0 ? rate : null, actualRate: actual, rateOk });
    sum += v;
  }
  // 3b) misread repair. A blurry photo can turn one digit wrong (166,600 -> 166,000); then the lines no longer
  //     add up and the printed totals get mistaken for deduction lines. If two printed values agree with the
  //     gross by themselves (deductions + net = gross), trust them, drop them from the lines, and point at the
  //     line that was misread. Runs only when the lines do NOT add up, so a real overcharge is never hidden.
  const printedVals = [...subtotals, ...netLines, ...regular.map((d) => d.amount), P(data.total_deductions), P(data.net)]
    .filter((v) => Number.isFinite(v) && v > 0);
  // The net is what the farmer is paid, so it is the anchor: a model can echo a wrong total-deductions line
  // that matches its own misread (seen: 50,700), but it rarely invents a net that also fits.
  const netCands = [...netLines, P(data.net)].filter((v) => Number.isFinite(v) && v > 0);
  const linesAgree = netCands.length
    ? netCands.some((v) => near(v, gross - sum, gross))
    : subtotals.some((v) => near(v, sum, sum)) || near(P(data.total_deductions), sum, sum);
  let repaired = null, ambiguous = false;
  // 3a) prefix anchor: the first k lines + a printed net = the verified sale. Lines after them are totals;
  //     if one of them does not match, it was misread (seen on a real photo: 337,000 read as 33,700).
  if (!linesAgree && gross && regular.length >= 2) {
    const nets = [...netCands, ...regular.map((d) => d.amount)];
    let acc = 0;
    for (let k = 1; k < regular.length && !repaired; k++) {
      acc += regular[k - 1].amount;
      // exact to the last unit: this rule rewrites the structure, so no tolerance
      const N = nets.find((v) => Math.abs(acc + v - gross) <= 0.005 && v > acc);
      if (N === undefined) continue;
      const rest = regular.slice(k).filter((d) => d.amount !== N);
      // Only a single trailing line (the printed subtotal) may be set aside. If more lines would be dropped, the
      // "net" is more likely a misread that happens to fit a prefix (seen: 48,825 = 52,500 − first two fees),
      // and dropping real fee lines would show a confident wrong answer.
      if (rest.length > 1) continue;
      netLines.push(N);
      for (const d of rest) {
        if (Math.abs(d.amount - acc) <= 0.005) { subtotals.push(d.amount); } else add('misread:' + d.label, false, `“${d.label}” reads ${d.amount}, but the lines above add up to ${acc} and match the slip's net — please look at the photo`);
        const i = checks.findIndex((c) => c.id === 'rate:' + d.label); if (i >= 0) checks.splice(i, 1);
      }
      regular.length = k;
      sum = acc;
      repaired = { D: acc, N };
    }
  }
  if (!linesAgree && gross && !repaired) {
    let pair = null;
    for (const D of printedVals) for (const N of printedVals) {
      if (D < N && D !== N && near(D + N, gross, gross)) { pair = { D, N }; break; }
    }
    if (pair) {
      const drop = (arr, v) => { const i = arr.findIndex((d) => d.amount === v); if (i >= 0) arr.splice(i, 1); };
      drop(regular, pair.D); drop(regular, pair.N);
      sum = regular.reduce((s, d) => s + d.amount, 0);
      const diff = pair.D - sum;
      if (!near(sum, pair.D, pair.D)) {
        const cand = regular.filter((d) => d.statedRate && near(d.amount + diff, (gross * d.statedRate) / 100, gross));
        const fix = cand.length === 1 ? cand[0] : null;
        if (fix) {
          add('misread:' + fix.label, false, `read as ${fix.amount}; the slip's own totals imply ${fix.amount + diff} — please look at the photo`);
          fix.readAs = fix.amount; fix.amount += diff; fix.actualRate = (100 * fix.amount) / gross; fix.rateOk = true;
          const i = checks.findIndex((c) => c.id === 'rate:' + fix.label); if (i >= 0) checks.splice(i, 1);
          sum = pair.D;
        } else {
          ambiguous = true;
          add('lines', false, `the lines add up to ${sum}, but the slip's totals say ${pair.D} (and agree with the sale) — one line may be misread, please look at the photo`);
        }
      }
      repaired = pair;
      subtotals.push(pair.D); netLines.push(pair.N);
    }
  }
  // 3c) copied-value repair: a deduction line that equals the printed net was copied from the net line
  //     (seen on a handwritten chit: Transport read as 46,400 = Net paid). Infer it from the printed net.
  const netField = P(data.net);
  if (!linesAgree && !repaired && Number.isFinite(netField) && netField > 0) {
    const copied = regular.filter((d) => near(d.amount, netField, netField));
    if (copied.length === 1) {
      const others = sum - copied[0].amount;
      const implied = gross - netField - others;
      if (implied > 0 && implied < gross * 0.5) {
        add('misread:' + copied[0].label, false, `read as ${copied[0].amount} (the same as the net line); the slip's net implies ${implied} — please look at the photo`);
        copied[0].readAs = copied[0].amount; copied[0].amount = implied; copied[0].actualRate = (100 * implied) / gross;
        sum = others + implied;
        repaired = { D: sum, N: netField };
      }
    }
  }
  const totalDeductions = repaired ? repaired.D : sum;
  const net = repaired ? repaired.N : gross - totalDeductions;

  // 4) printed totals vs the math (model may misplace them; we only need one printed copy to agree)
  const dedCandidates = [...subtotals, P(data.total_deductions)].filter(Number.isFinite);
  const netCandidates = [...netLines, P(data.net)].filter(Number.isFinite);
  const dedPrinted = dedCandidates.find((v) => near(v, totalDeductions, totalDeductions)) ?? dedCandidates[0];
  const netPrinted = netCandidates.find((v) => near(v, net, net)) ?? netCandidates[0];
  // After a repair, a total that matches nothing is the model's own echo of its misread, not a printed line.
  const netAgrees = netPrinted !== undefined && near(netPrinted, net, net);
  // When the net (the anchor) agrees, a stray total_deductions value is the model mislabeling a line, not the slip.
  const echo = !near(dedPrinted, totalDeductions, totalDeductions) && (repaired || (netAgrees && !subtotals.length));
  if (dedPrinted !== undefined && !echo) add('total_deductions', near(dedPrinted, totalDeductions, totalDeductions), `lines add up to ${totalDeductions}, printed ${dedPrinted}`);
  if (netPrinted !== undefined) add('net', near(netPrinted, net, net), `gross - deductions = ${net}, printed ${netPrinted}`);

  const totalKg = items.reduce((s, i) => s + i.kg, 0);
  // A row whose qty x price is off while the amounts still add up to the printed total is a misread qty/price,
  // not a money problem: keep it in the details, not in the alerts.
  if (grossOk) for (const c of checks) if (c.id.startsWith('row:') && !c.ok && !/read as/.test(c.detail)) c.minor = true;
  const warnings = checks.filter((c) => !c.ok && !c.minor);
  // Too scrambled to trust (rows shifted, totals disagree): say so instead of showing a confident wrong number.
  const failed = (id) => checks.some((c) => c.id === id && !c.ok);
  const nothingToVerify = netPrinted === undefined && dedPrinted === undefined;
  const unreliable = !items.length || ambiguous || nothingToVerify || (failed('net') && !repaired) || (failed('gross') && (failed('net') || failed('total_deductions') || failed('lines')));
  // Never accuse on a slip we could not verify: a shifted row can make a fair fee look wrong.
  if (unreliable) for (const d of regular) if (d.rateOk === false) { d.rateOk = null; d.unverified = true; }
  return {
    salvaged,
    repaired: !!repaired,
    items,
    gross,
    deductions: regular,
    totalDeductions,
    net,
    netPrinted,
    deductionShare: gross ? totalDeductions / gross : NaN,
    netPerKg: Number.isFinite(totalKg) && totalKg > 0 ? net / totalKg : null,
    checks,
    warnings,
    allClear: warnings.length === 0,
    unreliable,
  };
}
