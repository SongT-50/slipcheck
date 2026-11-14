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
curSel.addEventListener('change', () => { try { localStorage.setItem('slipcheck.currency', curSel.value); } catch (_) {} });
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
  $('histList').innerHTML = '';
  for (const r of rows) {
    const cur = curSel.value; curSel.value = r.currency;           // format in the slip's own currency
    const net = Number.isFinite(r.result?.net) ? money(r.result.net) : '—';
    curSel.value = cur;
    const flagged = r.result?.deductions?.some((d) => d.rateOk === false) || r.result?.warnings?.length;
    const src = r.thumb ? (thumbs[thumbs.push(URL.createObjectURL(r.thumb)) - 1]) : '';
    const li = document.createElement('li');
    li.innerHTML = `<button><img alt="" ${src ? `src="${src}"` : ''}><span><b>${esc(net)}</b>`
      + `<small>${new Date(r.ts).toLocaleString()}${r.explainPending ? ' · explain when online' : ''}</small></span>`
      + `<span class="flag ${flagged ? '' : 'ok'}">${flagged ? 'Check' : 'OK'}</span></button>`;
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
  show('s-read');
  const t0 = performance.now();
  const tick = setInterval(() => {
    const s = (performance.now() - t0) / 1000;
    $('secs').textContent = s.toFixed(0);
    $('bar').style.width = Math.min(95, (s / 55) * 100) + '%';
  }, 500);
  const read = async () => { try { return await extractSlip(blob); } catch (e) { return { raw: '', stopped: String(e) }; } };
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
function render(r, meta = {}) {
  $('where').textContent = [WHERE[meta.source], meta.sec ? `${meta.sec.toFixed(0)} s` : ''].filter(Boolean).join(' · ');
  if (!Number.isFinite(r.net) || !r.items.length || r.unreliable) {
    $('netAmt').textContent = '—';
    $('netSub').textContent = 'Could not read this slip. Try a flatter, brighter photo.';
    $('stack').innerHTML = $('legend').innerHTML = $('alerts').innerHTML = $('checks').innerHTML = '';
    show('s-result'); return;
  }
  $('netAmt').textContent = money(r.net);
  const perKg = r.netPerKg ? ` · <b>${money(r.netPerKg)} / kg</b>` : '';
  $('netSub').innerHTML = `from ${money(r.gross)} sold${perKg}`;
  const parts = [{ label: 'You received', amount: r.net, color: '#2f6b4f' },
    ...r.deductions.map((d, i) => ({ label: d.label, amount: d.amount, color: COLORS[i % COLORS.length], d }))];
  $('stack').innerHTML = parts.map((p) => `<span style="width:${(100 * p.amount) / r.gross}%;background:${p.color}"></span>`).join('');
  $('legend').innerHTML = parts.map((p) => {
    const pct = ((100 * p.amount) / r.gross).toFixed(p.d ? 2 : 1);
    return `<li><i style="background:${p.color}"></i>${esc(p.label)} ${p.d ? money(p.amount) + ` (${pct}%)` : pct + '%'}</li>`;
  }).join('');
  const bad = r.deductions.filter((d) => d.rateOk === false);
  const other = r.warnings.filter((w) => !w.id.startsWith('rate:'));
  $('alerts').innerHTML = bad.map((d) => {
    const exp = (r.gross * d.statedRate) / 100;
    return `<div class="alert"><b>Check this line.</b> “${esc(d.label)}” says ${d.statedRate}%, but ${d.statedRate}% of ${money(r.gross)} is ${money(exp)}. You were charged ${money(d.amount)} (${d.amount > exp ? '+' : ''}${money(d.amount - exp)}).</div>`;
  }).join('') + other.map((w) => `<div class="alert">${esc(w.detail)}</div>`).join('')
    + (r.allClear ? '<div class="alert ok">Every row and total adds up.</div>' : '');
  $('checksSum').textContent = `${r.checks.filter((c) => c.ok).length}/${r.checks.length} checks passed${r.salvaged ? ' · recovered from a damaged read' : ''}`;
  $('checks').innerHTML = r.checks.map((c) => `<li>${c.ok ? '✓' : '⚠'} ${esc(c.detail)}</li>`).join('');
  show('s-result');
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
