import { reconcile } from './reconcile.js';
import { onDeviceStatus, extractSlip } from './extract.js';
import { guessTurns, turn } from './orient.js';
import { saveSlip, updateSlip, listSlips, clearSlips, thumbnail } from './history.js';
import { buildLedger } from './ledger.js';
import { script, speak, stopSpeaking } from './speak.js';

// ---- offline: cache the app so it opens with no signal ----
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

const $ = (id) => document.getElementById(id);
const screens = ['s-scan', 's-check', 's-read', 's-result', 's-cloud', 's-season'];
const show = (id) => { stopSpeaking(); screens.forEach((s) => ($(s).hidden = s !== id)); };
const COLORS = ['#b23b3b', '#b7791f', '#2c5d8a', '#6b4f8a', '#8a6b2f', '#3f7f7f'];
let last = null;

// ---- currency (user setting, never guessed by the model) ----
const curSel = $('currency');
try { const c = localStorage.getItem('slipcheck.currency'); if (c) curSel.value = c; } catch (_) {}
const curLabel = () => { $('curSum').textContent = 'Currency: ' + curSel.selectedOptions[0].textContent; };
curSel.addEventListener('change', () => { curLabel(); try { localStorage.setItem('slipcheck.currency', curSel.value); } catch (_) {} });
curLabel();
const symbol = () => curSel.value.split('|')[1];
const decimals = () => (curSel.value.startsWith('KRW') ? 0 : 2);
const money = (n) => `${symbol()}${symbol().length > 1 ? ' ' : ''}${n.toLocaleString('en-US', { minimumFractionDigits: decimals(), maximumFractionDigits: decimals() })}`;

// ---- connection + on-device status ----
function netPill() {
  const on = navigator.onLine;
  $('net').textContent = on ? 'ONLINE' : 'OFFLINE · ON-DEVICE';
  $('net').classList.toggle('off', !on);
}
addEventListener('online', () => { netPill(); showHistory(); });
addEventListener('offline', netPill); netPill();
onDeviceStatus().then((s) => {
  $('device').textContent = s === 'available' ? 'On-device AI is ready on this device.'
    : s === 'unsupported' ? 'This browser has no on-device AI. Use Chrome on desktop or Android.'
    : `On-device AI status: ${s}.`;
});

// ---- input ----
$('photo').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) check(f); });

// ---- check the photo: orientation, one tap ----
let chk = null; // { bmp, turns, url }
async function check(file) {
  const bmp = await createImageBitmap(file); // applies the camera's EXIF orientation
  chk = { bmp, turns: guessTurns(bmp), url: null };
  await drawCheck();
  show('s-check');
}
async function drawCheck() {
  if (chk.url) URL.revokeObjectURL(chk.url);
  chk.blob = await turn(chk.bmp, chk.turns);
  chk.url = URL.createObjectURL(chk.blob);
  $('checkImg').src = chk.url;
}
$('turnL').addEventListener('click', async () => { chk.turns += 3; await drawCheck(); });
$('turnR').addEventListener('click', async () => { chk.turns += 1; await drawCheck(); });
$('readIt').addEventListener('click', () => run(chk.blob));
document.querySelectorAll('[data-sample]').forEach((b) => b.addEventListener('click', async () => {
  curSel.value = b.dataset.cur;
  run(await (await fetch(b.dataset.sample)).blob());
}));
$('again').addEventListener('click', () => { showHistory(); show('s-scan'); });
$('back').addEventListener('click', () => show('s-result'));
$('explain').addEventListener('click', () => {
  if (navigator.onLine) {
    explainNow();
  } else {
    $('cloudMsg').textContent = 'You are offline. Your result is saved on this device; the explanation will be ready when you reconnect.';
    if (last?.id) updateSlip(last.id, { explainPending: true });
  }
  show('s-cloud');
});

async function explainNow() {
  const r = last?.result;
  if (!r || !Number.isFinite(r.net)) { $('cloudMsg').textContent = 'Nothing to explain yet.'; return; }
  $('cloudMsg').textContent = 'Asking the cloud model… (only the line names are sent — not your photo, not your amounts)';
  try {
    const fb = await import('./firebase.js');
    const w = await fb.explainWords(r.deductions.map((d) => d.label), navigator.language || 'en');
    const text = explainText(r, w);
    $('cloudMsg').textContent = text;
    if (last.id) updateSlip(last.id, { explainPending: false, explanation: text });
  } catch (e) {
    console.warn('explain failed', e);
    $('cloudMsg').textContent = 'Could not reach the cloud model. Your result is still saved on this device.';
  }
}

/** Numbers come from reconcile(); the model only supplied words. */
export function explainText(r, w) {
  const lines = [`${w.total_sale}: ${money(r.gross)}`, ''];
  r.deductions.forEach((d, i) => {
    lines.push(`• ${d.label}: ${money(d.amount)} — ${w.meanings?.[i] || ''}`.trim());
    if (d.rateOk === false) {
      lines.push('  ⚠ ' + String(w.mismatch)
        .replace('{stated}', `${d.statedRate}%`)
        .replace('{expected}', money((r.gross * d.statedRate) / 100))
        .replace('{charged}', money(d.amount)));
    }
  });
  lines.push('', `${w.you_received}: ${money(r.net)}`, `${w.share}: ${Math.round((100 * r.net) / r.gross)}%`);
  return lines.join(String.fromCharCode(10));
}
window.SLIPCHECK_EXPLAIN = { explainText }; // for testing

// ---- read aloud (offline: device voice, sentences built by code) ----
const VOICE_LANG = { KRW: 'ko', MXN: 'es', INR: 'en', USD: 'en' };
$('speak').addEventListener('click', () => {
  const cur = (last?.currency || curSel.value).split('|')[0];
  speak(script(last?.result, cur, VOICE_LANG[cur] || 'en'), VOICE_LANG[cur] || 'en');
});

/** The agent name the model copied from the top of the slip (optional field, used only to group the ledger). */
function issuerOf(raw) {
  try { const j = JSON.parse(raw); if (typeof j.issuer === 'string') return j.issuer.trim().slice(0, 80); } catch (_) {}
  const m = String(raw).match(/"issuer"\s*:\s*"([^"]{1,80})"/);
  return m ? m[1].trim() : '';
}

// ---- season ledger: every reconciled slip on this device, added up by code ----
async function showSeason() {
  const L = buildLedger(await listSlips(500), curSel.value);
  $('seasonSub').textContent = `${L.count} slip${L.count === 1 ? '' : 's'} on this device`
    + (L.skipped ? ` · ${L.skipped} not counted (photo could not be verified)` : '');
  $('seasonDed').textContent = Number.isFinite(L.share) ? money(L.deducted) : '—';
  $('seasonDedSub').innerHTML = Number.isFinite(L.share)
    ? `deducted from ${money(L.gross)} sold · <b>${(100 * L.share).toFixed(1)}%</b> · you received ${money(L.received)}`
      + (L.perKg ? ` · ${money(L.perKg)} / kg` : '') : 'No verified slips in this currency yet.';
  const max = Math.max(...L.byLabel.map((x) => x.amount), 1);
  $('seasonLabels').innerHTML = L.byLabel.map((x, i) => `<li><span>${esc(x.label)}</span>`
    + `<i style="width:${(100 * x.amount) / max}%;background:${COLORS[i % COLORS.length]}"></i><b>${money(x.amount)}</b></li>`).join('');
  $('seasonAgentsWrap').hidden = L.byIssuer.length < 2;
  const maxS = Math.max(...L.byIssuer.map((x) => x.share), 0.0001);
  $('seasonAgents').innerHTML = L.byIssuer.map((x) => `<li><span>${esc(x.issuer)} <small>${x.count} slip${x.count === 1 ? '' : 's'}</small></span>`
    + `<i style="width:${(100 * x.share) / maxS}%"></i><b>${(100 * x.share).toFixed(1)}%</b></li>`).join('');
  $('seasonFlag').hidden = !L.flagged;
  $('seasonFlag').textContent = `${L.flagged} slip${L.flagged === 1 ? '' : 's'} had a line that did not match its stated percentage.`;
  const maxShare = Math.max(...L.slips.map((x) => x.share), 0.0001);
  $('seasonSlips').innerHTML = L.slips.slice().reverse().map((x) => `<li class="${x.flagged ? 'flag' : ''}"><span>${new Date(x.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>`
    + `<span class="who">${esc(x.issuer || '—')}</span><i style="width:${(100 * x.share) / maxShare}%"></i><b>${(100 * x.share).toFixed(1)}%</b></li>`).join('');
  show('s-season');
}
$('seasonBtn').addEventListener('click', showSeason);
$('seasonBack').addEventListener('click', () => { showHistory(); show('s-scan'); });
window.SLIPCHECK_SEASON = showSeason; // for testing

// ---- history (IndexedDB, this device only) ----
let thumbs = [];
async function showHistory() {
  const rows = await listSlips();
  thumbs.forEach(URL.revokeObjectURL); thumbs = [];
  $('history').hidden = !rows.length;
  $('seasonBtn').hidden = rows.length < 2;
  if (rows.length >= 2) {
    const L = buildLedger(await listSlips(500), curSel.value);
    $('seasonPeek').textContent = L.count ? `Deductions took ${money(L.deducted)} (${(100 * L.share).toFixed(1)}%)` : 'Where did my money go?';
  }
  $('histList').innerHTML = '';
  for (const r of rows) {
    const cur = curSel.value; curSel.value = r.currency;           // format in the slip's own currency
    const verified = r.result && !r.result.unreliable && Number.isFinite(r.result.net);
    const net = verified ? money(r.result.net) : '—';   // never show an unverified number
    curSel.value = cur;
    const flagged = r.result?.deductions?.some((d) => d.rateOk === false) || r.result?.warnings?.length;
    const src = r.thumb ? (thumbs[thumbs.push(URL.createObjectURL(r.thumb)) - 1]) : '';
    const li = document.createElement('li');
    li.innerHTML = `<button><img alt="" ${src ? `src="${src}"` : ''}><span><b>${esc(net)}</b>`
      + `<small>${new Date(r.ts).toLocaleString()}${r.explainPending ? ' · explain when online' : ''}</small></span>`
      + `<span class="flag ${verified && !flagged ? 'ok' : ''}">${!verified ? 'Retake' : flagged ? 'Check' : 'OK'}</span></button>`;
    li.querySelector('button').addEventListener('click', () => {
      curSel.value = r.currency; last = r; render(r.result, r);
    });
    $('histList').append(li);
  }
}
let armed = false;
$('histClear').addEventListener('click', async () => {
  if (!armed) { armed = true; $('histClear').textContent = 'Tap again to delete all'; setTimeout(() => { armed = false; $('histClear').textContent = 'Delete all'; }, 4000); return; }
  armed = false; $('histClear').textContent = 'Delete all';
  await clearSlips(); showHistory();
});
showHistory();

async function run(blob) {
  $('preview').src = URL.createObjectURL(blob);
  $('readMsg').textContent = 'Reading on your device…';
  $('ticks').innerHTML = '';
  show('s-read');
  const t0 = performance.now();
  const tick = setInterval(() => {
    const s = (performance.now() - t0) / 1000;
    $('secs').textContent = s.toFixed(0);
    $('bar').style.width = Math.min(95, (s / 55) * 100) + '%';
  }, 500);
  // one pencil tick per amount the model has copied so far (streamed)
  let shown = 0;
  const onChunk = (text) => {
    const n = (text.match(/"amount"\s*:\s*"[^"]*\d[^"]*"/g) || []).length;
    for (; shown < n; shown++) {
      const li = document.createElement('li'); li.textContent = `line ${shown + 1}`; $('ticks').append(li);
    }
  };
  const read = async () => { shown = 0; $('ticks').innerHTML = ''; try { return await extractSlip(blob, { onChunk }); } catch (e) { return { raw: '', stopped: String(e) }; } };
  let out = await read(), result = reconcile(out.raw);
  // Second read: the on-device model is not deterministic, so a scrambled or cut-off read often comes out
  // right the next time. Keep whichever read reconciles.
  if (result.unreliable || out.stopped) {
    $('readMsg').textContent = 'Reading again to double-check…';
    const out2 = await read(), result2 = reconcile(out2.raw);
    if (!result2.unreliable || result.unreliable) { out = { ...out2, retried: true }; result = result2; }
  }
  clearInterval(tick);
  last = { ...out, sec: (performance.now() - t0) / 1000, result, currency: curSel.value };
  window.SLIPCHECK_LAST = last; // for testing
  render(last.result, last);
  if (out.raw) {
    last.issuer = issuerOf(out.raw);
    last.id = await saveSlip({ raw: out.raw, result: last.result, currency: last.currency, issuer: last.issuer,
      sec: last.sec, via: out.via, source: out.source, thumb: await thumbnail(blob) });
  }
}

const WHERE = { on_device: 'Read on this device', in_cloud: 'Read in the cloud (no on-device model here)' };
// Red-pen circle drawn around a wrong amount (one SVG path, drawn in 0.6 s unless reduced motion).
const CIRCLE = '<svg class="pen" viewBox="0 0 120 48" preserveAspectRatio="none" aria-hidden="true"><path d="M14 30 C8 12 52 4 84 6 C110 8 118 22 110 34 C100 46 40 47 18 38 C6 33 9 17 30 11"/></svg>';
function stamp(kind, text) {
  $('stamp').className = 'stamp ' + kind;
  $('stamp').textContent = text;
  $('stamp').hidden = false;
}
function render(r, meta = {}) {
  $('where').textContent = [WHERE[meta.source], meta.sec ? `${meta.sec.toFixed(0)} s` : ''].filter(Boolean).join(' · ');
  if (!Number.isFinite(r.net) || !r.items.length || r.unreliable) {
    $('lines').innerHTML = '';
    $('netAmt').textContent = '—';
    $('netSub').textContent = 'Could not read this slip clearly, so SlipCheck shows no number. Lay it flat in good light and take the photo again.';
    $('alerts').innerHTML = $('checks').innerHTML = '';
    $('checksSum').parentElement.hidden = true;   // no stale "5/6 checks" from the previous slip
    $('explain').hidden = true;                   // nothing verified to explain
    $('paper').classList.add('retake');
    stamp('grey', 'Retake');
    show('s-result'); return;
  }
  $('paper').classList.remove('retake');
  $('checksSum').parentElement.hidden = false;
  $('explain').hidden = false;
  const pct = (v) => ((100 * v) / r.gross).toFixed(1) + '%';
  const rows = [`<li class="line sold"><span class="lbl">Sold</span><i class="dots"></i><span class="amt">${money(r.gross)}</span></li>`];
  for (const d of r.deductions) {
    if (d.rateOk === false) {
      const exp = (r.gross * d.statedRate) / 100, diff = d.amount - exp;
      rows.push(`<li class="line bad"><span class="lbl">${esc(d.label)}</span><i class="dots"></i><span class="amt">−${money(d.amount)}${CIRCLE}</span></li>`
        + `<li class="note">${diff > 0 ? '+' : '−'}${money(Math.abs(diff))} <small>vs ${d.statedRate}% of the sale</small></li>`);
    } else {
      rows.push(`<li class="line"><span class="lbl">${esc(d.label)} <small>${pct(d.amount)}</small></span><i class="dots"></i><span class="amt">−${money(d.amount)}</span></li>`);
    }
  }
  $('lines').innerHTML = rows.join('');
  $('netAmt').textContent = money(r.net);
  const perKg = r.netPerKg ? ` · ${money(r.netPerKg)} / kg` : '';
  $('netSub').textContent = `${pct(r.net)} of the sale${perKg}`;
  const bad = r.deductions.filter((d) => d.rateOk === false);
  const other = r.warnings.filter((w) => !w.id.startsWith('rate:'));
  if (bad.length) stamp('red', bad.length === 1 ? 'Check 1 line' : `Check ${bad.length} lines`);
  else if (other.length) stamp('amber', 'Look at photo');
  else stamp('green', 'Checked');
  $('alerts').innerHTML = bad.map((d) => {
    const exp = (r.gross * d.statedRate) / 100;
    return `<div class="alert"><b>${esc(d.label)}</b> says ${d.statedRate}%. ${d.statedRate}% of ${money(r.gross)} is ${money(exp)}, but ${money(d.amount)} was charged.</div>`;
  }).join('') + other.map((w) => `<div class="alert">${esc(w.detail)}</div>`).join('');
  $('checksSum').textContent = `${r.checks.filter((c) => c.ok).length}/${r.checks.length} checks passed${r.salvaged ? ' · recovered from a damaged read' : ''}`;
  $('checks').innerHTML = plainChecks(r).map(([ok, t]) => `<li class="${ok ? 'ok' : 'no'}"><span>${esc(t)}</span><b>${ok ? '✓' : '!'}</b></li>`).join('');
  show('s-result');
}

/** The engine's checks, said the way a farmer would check them by hand. */
function plainChecks(r) {
  const out = [];
  for (const i of r.items) {
    const c = r.checks.find((x) => x.id === 'row:' + (i.product || '?'));
    out.push([!c || c.ok || c.minor, `${i.product || 'Row'}  ${i.qty.toLocaleString('en-US')} × ${money(i.price)} = ${money(i.amount)}`]);
  }
  const g = r.checks.find((x) => x.id === 'gross');
  if (g) out.push([g.ok, `Rows add up to ${money(r.gross)}`]);
  for (const d of r.deductions) if (d.statedRate) {
    out.push([d.rateOk !== false, `${d.label}: ${d.statedRate}% of ${money(r.gross)} = ${money((r.gross * d.statedRate) / 100)}, charged ${money(d.amount)}`]);
  }
  const t = r.checks.find((x) => x.id === 'total_deductions');
  if (t) out.push([t.ok, `Deductions add up to ${money(r.totalDeductions)}`]);
  const n = r.checks.find((x) => x.id === 'net');
  if (n) out.push([n.ok, `${money(r.gross)} − ${money(r.totalDeductions)} = ${money(r.net)}`]);
  for (const c of r.checks) if (c.id.startsWith('misread:') || c.id === 'lines') out.push([false, c.detail]);
  return out;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
