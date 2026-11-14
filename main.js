import { reconcile } from './reconcile.js';
import { onDeviceStatus, extractSlip } from './extract.js';
import { guessTurns, turn, photoQuality } from './orient.js';
import { saveSlip, updateSlip, listSlips, clearSlips, thumbnail } from './history.js';
import { buildLedger } from './ledger.js';
import { script, speak, stopSpeaking } from './speak.js';
import { t, setLang, getLang, pickUiLang, applyI18n, LANGS } from './i18n.js';

// ---- offline: cache the app so it opens with no signal ----
if ('serviceWorker' in navigator && !self.SlipNative) navigator.serviceWorker.register('sw.js').catch(() => {});

const $ = (id) => document.getElementById(id);
const screens = ['s-scan', 's-check', 's-read', 's-result', 's-cloud', 's-season', 's-history', 's-settings', 's-consent'];
// which bottom tab is lit for each screen
const TAB_OF = { 's-history': 'history', 's-season': 'ledger', 's-settings': 'settings' };
const show = (id) => {
  stopSpeaking();
  screens.forEach((s) => ($(s).hidden = s !== id));
  const tab = TAB_OF[id] || 'scan';
  document.querySelectorAll('#tabs button').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));
  scrollTo(0, 0);
  if (id === 's-scan') renderHome();
};
// Android back button: any other screen goes back to the scan screen; on the scan screen the app closes.
// (Not while a slip is being read.)
self.__slipBack = () => {
  const cur = screens.find((s) => !$(s).hidden);
  if (cur === 's-scan' || cur === 's-read') return cur === 's-read';
  show('s-scan');
  return true;
};
// ---- screen language: phone language by default, changeable in Settings ----
const langSel = $('uiLang');
langSel.innerHTML = `<option value="auto"></option>` + Object.entries(LANGS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
let langPref = 'auto';
try { langPref = localStorage.getItem('slipcheck.lang') || 'auto'; } catch (_) {}
langSel.value = langPref;
function applyLang() {
  setLang(langSel.value === 'auto' ? pickUiLang() : langSel.value);
  applyI18n();
  langSel.options[0].textContent = t('langAuto') + ` (${LANGS[pickUiLang()]})`;
}
langSel.addEventListener('change', () => {
  try { localStorage.setItem('slipcheck.lang', langSel.value); } catch (_) {}
  applyLang(); curLabel(); netPill();
  if (!$('s-history').hidden) showHistory();
  if (last?.result && !$('s-result').hidden) render(last.result, last);
});
applyLang();
const COLORS = ['#b23b3b', '#b7791f', '#2c5d8a', '#6b4f8a', '#8a6b2f', '#3f7f7f'];
let last = null;

// ---- currency (user setting, never guessed by the model) ----
const curSel = $('currency');
try { const c = localStorage.getItem('slipcheck.currency'); if (c) curSel.value = c; } catch (_) {}
function curLabel() { $('curSum').textContent = t('currency') + ': ' + curSel.selectedOptions[0].textContent + ' · ' + t('change'); }
curSel.addEventListener('change', () => { curLabel(); try { localStorage.setItem('slipcheck.currency', curSel.value); } catch (_) {} });
curLabel();
const symbol = () => curSel.value.split('|')[1];
const decimals = () => (curSel.value.startsWith('KRW') ? 0 : 2);
const money = (n) => `${symbol()}${symbol().length > 1 ? ' ' : ''}${n.toLocaleString('en-US', { minimumFractionDigits: decimals(), maximumFractionDigits: decimals() })}`;

// ---- connection + on-device status ----
function netPill() {
  const on = navigator.onLine;
  $('net').textContent = on ? t('online') : t('offlinePill');
  $('net').classList.toggle('off', !on);
}
addEventListener('online', () => {
  netPill(); showHistory();
  // keep the promise made offline: explain as soon as the connection is back
  if (!$('s-cloud').hidden && last?.result) { $('cloudHead').textContent = t('explainOnline'); explainNow(); }
});
addEventListener('offline', netPill); netPill();
onDeviceStatus().then((s) => {
  $('device').textContent = s === 'available' ? t('devReady') : s === 'unsupported' ? t('devNone') : t('devStatus', { s });
});

// ---- input ----
$('photo').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) check(f); });

// ---- check the photo: orientation, one tap ----
let chk = null; // { bmp, turns, url }
async function check(file) {
  const bmp = await createImageBitmap(file); // applies the camera's EXIF orientation
  chk = { bmp, turns: guessTurns(bmp), url: null };
  const q = photoQuality(bmp);
  lastQuality = q;
  const msg = q.blurry && q.dark ? t('blurDark') : q.blurry ? t('blurry') : q.dark ? t('dark') : '';
  $('qualityHint').textContent = msg; $('qualityHint').hidden = !msg;
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
  curSel.value = b.dataset.cur; lastQuality = null;
  run(await (await fetch(b.dataset.sample)).blob());
}));
$('again').addEventListener('click', () => { showHistory(); show('s-scan'); });
// ---- bottom tabs: always one tap to anywhere, instead of chains of Back ----
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', async () => {
  const tab = b.dataset.tab;
  if (tab === 'scan') show('s-scan');
  else if (tab === 'history') { await showHistory(); show('s-history'); }
  else if (tab === 'ledger') showSeason();
  else show('s-settings');
}));
$('curSum').addEventListener('click', () => show('s-settings'));
$('back').addEventListener('click', () => show('s-result'));
$('explain').addEventListener('click', () => {
  if (navigator.onLine) {
    $('cloudHead').textContent = t('explainOnline');
    explainNow();
  } else {
    $('cloudHead').textContent = t('explainOffline');
    $('cloudMsg').textContent = t('explainOfflineMsg');
    if (last?.id) updateSlip(last.id, { explainPending: true });
  }
  show('s-cloud');
});

async function explainNow() {
  const r = last?.result;
  if (!r || !Number.isFinite(r.net)) { $('cloudMsg').textContent = t('nothingExplain'); return; }
  $('cloudMsg').textContent = t('explainWait');
  try {
    const fb = await import(self.SlipNative ? './native.js' : './firebase.js');
    const w = await fb.explainWords(r.deductions.map((d) => d.label), getLang());
    const text = explainText(r, w);
    $('cloudMsg').textContent = text;
    if (last.id) updateSlip(last.id, { explainPending: false, explanation: text });
  } catch (e) {
    console.warn('explain failed', e);
    $('cloudMsg').textContent = t('cloudFail');
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
  lines.push('', `${w.you_received}: ${money(r.net)}`, `${w.share}: ${((100 * r.net) / r.gross).toFixed(1)}%`);
  return lines.join(String.fromCharCode(10));
}
window.SLIPCHECK_EXPLAIN = { explainText }; // for testing

// ---- read aloud (offline: device voice, sentences built by code) ----
// the voice follows the screen language the farmer chose (not the currency)
$('speak').addEventListener('click', () => {
  const cur = (last?.currency || curSel.value).split('|')[0];
  speak(script(last?.result, cur, getLang()), getLang());
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
  $('seasonSub').textContent = t('slipsOnDevice', { n: L.count }) + (L.skipped ? ' · ' + t('notCounted', { n: L.skipped }) : '');
  $('seasonDed').textContent = Number.isFinite(L.share) ? money(L.deducted) : '—';
  $('seasonDedSub').innerHTML = Number.isFinite(L.share)
    ? t('dedFrom', { gross: money(L.gross), p: (100 * L.share).toFixed(1) + '%', net: money(L.received) })
      + (L.perKg ? ` · ${money(L.perKg)} / kg` : '') : t('noVerified');
  const max = Math.max(...L.byLabel.map((x) => x.amount), 1);
  $('seasonLabels').innerHTML = L.byLabel.map((x, i) => `<li><span>${esc(x.label)}</span>`
    + `<i style="width:${(100 * x.amount) / max}%;background:${COLORS[i % COLORS.length]}"></i><b>${money(x.amount)}</b></li>`).join('');
  $('seasonAgentsWrap').hidden = L.byIssuer.length < 2;
  const maxS = Math.max(...L.byIssuer.map((x) => x.share), 0.0001);
  $('seasonAgents').innerHTML = L.byIssuer.map((x) => `<li><span>${esc(x.issuer)} <small>${t('slipsN', { n: x.count })}</small></span>`
    + `<i style="width:${(100 * x.share) / maxS}%"></i><b>${(100 * x.share).toFixed(1)}%</b></li>`).join('');
  $('seasonFlag').hidden = !L.flagged;
  $('seasonFlag').textContent = t('flaggedN', { n: L.flagged });
  const maxShare = Math.max(...L.slips.map((x) => x.share), 0.0001);
  $('seasonSlips').innerHTML = L.slips.slice().reverse().map((x) => `<li class="${x.flagged ? 'flag' : ''}"><span>${new Date(x.ts).toLocaleDateString(getLang(), { month: 'short', day: 'numeric' })}</span>`
    + `<span class="who">${esc(x.issuer || '—')}</span><i style="width:${(100 * x.share) / maxShare}%"></i><b>${(100 * x.share).toFixed(1)}%</b></li>`).join('');
  show('s-season');
}
$('seasonBtn').addEventListener('click', showSeason);
window.SLIPCHECK_SEASON = showSeason; // for testing

// ---- history (IndexedDB, this device only) ----
let thumbs = [];
async function showHistory() {
  const rows = await listSlips();
  thumbs.forEach(URL.revokeObjectURL); thumbs = [];
  $('history').hidden = !rows.length;
  $('histEmpty').hidden = !!rows.length;
  $('seasonBtn').hidden = rows.length < 2;
  if (rows.length >= 2) {
    const L = buildLedger(await listSlips(500), curSel.value);
    $('seasonPeek').textContent = L.count ? t('dedTook', { x: money(L.deducted), p: (100 * L.share).toFixed(1) + '%' }) : t('whereMoney');
  }
  $('histList').innerHTML = '';
  for (const r of rows) $('histList').append(slipRow(r));
}
function slipRow(r) {
  {
    const cur = curSel.value; curSel.value = r.currency;           // format in the slip's own currency
    const verified = r.result && !r.result.unreliable && Number.isFinite(r.result.net);
    const net = verified ? money(r.result.net) : '—';   // never show an unverified number
    curSel.value = cur;
    const flagged = r.result?.deductions?.some((d) => d.rateOk === false) || r.result?.warnings?.length;
    const src = r.thumb ? (thumbs[thumbs.push(URL.createObjectURL(r.thumb)) - 1]) : '';
    const li = document.createElement('li');
    li.innerHTML = `<button><img alt="" ${src ? `src="${src}"` : ''}><span><b>${esc(net)}</b>`
      + `<small>${new Date(r.ts).toLocaleString(getLang(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}${r.explainPending ? ' · ' + t('explainLater') : ''}</small></span>`
      + `<span class="flag ${verified && !flagged ? 'ok' : flagged && verified ? 'chk' : ''}">${!verified ? t('stampRetake') : flagged ? t('flagBadge') : '✓'}</span></button>`;
    li.querySelector('button').addEventListener('click', () => {
      curSel.value = r.currency; last = r; render(r.result, r);
    });
    return li;
  }
}

// ---- first screen: a first visit gets the introduction; after that, a status board ----
// (take a photo · this season at a glance · the latest slips), so everything is one tap away.
async function renderHome() {
  const rows = await listSlips(500).catch(() => []);
  const returning = rows.length > 0;
  $('intro').hidden = returning;
  $('homeHello').hidden = !returning;
  $('home').hidden = !returning;
  document.querySelector('#s-scan .tips').classList.toggle('compact', returning);
  if (!returning) return;
  // the board follows the currency of the latest slip (a season is one market, one currency)
  const keep = curSel.value; curSel.value = rows[0].currency || keep;
  const L = buildLedger(rows, curSel.value);
  const ok = Number.isFinite(L.share);
  $('hcRecv').textContent = ok ? money(L.received) : '—';
  curSel.value = keep;
  $('hcDed').textContent = ok ? (100 * L.share).toFixed(1) + '%' : '—';
  $('hcN').textContent = String(L.count);
  $('hcFlag').hidden = !L.flagged;
  $('hcFlag').textContent = t('needCheck', { n: L.flagged });
  thumbs.forEach(URL.revokeObjectURL); thumbs = [];
  $('homeList').replaceChildren(...rows.slice(0, 3).map(slipRow));
}
$('homeSeason').addEventListener('click', showSeason);
$('homeAll').addEventListener('click', async () => { await showHistory(); show('s-history'); });
let armed = false;
$('histClear').addEventListener('click', async () => {
  if (!armed) { armed = true; $('histClear').textContent = t('tapAgain'); setTimeout(() => { armed = false; $('histClear').textContent = t('deleteAll'); }, 4000); return; }
  armed = false; $('histClear').textContent = t('deleteAll');
  await clearSlips(); showHistory();
});
showHistory(); renderHome();

// ---- where a slip is read: on this device by default; the cloud only with the user's OK ----
let lastBlob = null, pendingBlob = null, lastQuality = null;
// A photo too blurry or dark for this device is never sent to the cloud either: a cloud model can invent
// numbers that still add up (seen 11/14: a blurred slip came back as 2,010 / 201 / 1,809 and passed the checks).
const tooPoor = () => !!(lastQuality && (lastQuality.blurry || lastQuality.dark));
function askCloud(blob, why) {
  pendingBlob = blob;
  const online = navigator.onLine;
  $('consentWhy').textContent = why === 'unverified' ? t('whyUnverified') : t('whyNoDevice');
  $('consentText').textContent = why === 'unverified' ? t('consentUnverified') : online ? t('consentNoDevice') : t('consentOffline');
  if (tooPoor()) {
    $('consentWhy').textContent = t('whyPoor');
    $('consentText').textContent = t('consentPoor');
  }
  $('cloudYes').hidden = !online || tooPoor();
  show('s-consent');
}
$('cloudYes').addEventListener('click', () => { if (pendingBlob) run(pendingBlob, 'cloud'); });
$('cloudNo').addEventListener('click', () => show('s-scan'));
$('cloudRetry').addEventListener('click', () => { if (lastBlob) askCloud(lastBlob, 'unverified'); });

async function run(blob, where = 'device') {
  if (where === 'device' && (await onDeviceStatus()) !== 'available') { askCloud(blob, 'no-device'); return; }
  lastBlob = blob;
  $('preview').src = URL.createObjectURL(blob);
  const cloud = where === 'cloud';
  $('readMsg').textContent = cloud ? t('readingCloud') : t('readingDevice');
  $('readWhere').textContent = cloud ? t('whereCloud') : t('whereDevice');
  $('readNote').textContent = cloud ? t('noteCloud') : t('noteDevice');
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
    const amts = [...text.matchAll(/"amount"\s*:\s*"([^"]*\d[^"]*)"/g)].map((m) => m[1]);
    for (; shown < amts.length; shown++) {
      const li = document.createElement('li'); li.textContent = amts[shown]; $('ticks').append(li);
    }
  };
  const read = async () => { shown = 0; $('ticks').innerHTML = ''; try { return await extractSlip(blob, { onChunk, where }); } catch (e) { return { raw: '', stopped: String(e) }; } };
  let out = await read(), result = reconcile(out.raw);
  // Second read: the on-device model is not deterministic, so a scrambled or cut-off read often comes out
  // right the next time. Keep whichever read reconciles.
  if (!cloud && (result.unreliable || out.stopped)) {
    $('readMsg').textContent = t('readingAgain');
    const out2 = await read(), result2 = reconcile(out2.raw);
    if (!result2.unreliable || result.unreliable) { out = { ...out2, retried: true }; result = result2; }
  }
  clearInterval(tick);
  last = { ...out, source: out.source === 'unknown' ? (cloud ? 'in_cloud' : 'on_device') : out.source, sec: (performance.now() - t0) / 1000, result, currency: curSel.value, live: true };
  window.SLIPCHECK_LAST = last; // for testing
  render(last.result, last);
  if (out.raw) {
    last.issuer = issuerOf(out.raw);
    last.id = await saveSlip({ raw: out.raw, result: last.result, currency: last.currency, issuer: last.issuer,
      sec: last.sec, via: out.via, source: out.source, thumb: await thumbnail(blob) });
  }
}

const WHERE = { on_device: 'readOnDevice', in_cloud: 'readInCloud' };
// Red-pen circle drawn around a wrong amount (one SVG path, drawn in 0.6 s unless reduced motion).
const CIRCLE = '<svg class="pen" viewBox="0 0 120 48" preserveAspectRatio="none" aria-hidden="true"><path d="M14 30 C8 12 52 4 84 6 C110 8 118 22 110 34 C100 46 40 47 18 38 C6 33 9 17 30 11"/></svg>';
function stamp(kind, text) {
  $('stamp').className = 'stamp ' + kind;
  $('stamp').textContent = text;
  $('stamp').hidden = false;
}
function render(r, meta = {}) {
  $('where').textContent = [WHERE[meta.source] && t(WHERE[meta.source]), meta.sec ? `${meta.sec.toFixed(0)} s` : ''].filter(Boolean).join(' · ');
  if (!Number.isFinite(r.net) || !r.items.length || r.unreliable) {
    $('lines').innerHTML = '';
    $('netAmt').textContent = '—';
    $('netSub').textContent = t('retakeMsg');
    $('alerts').innerHTML = $('checks').innerHTML = '';
    $('checksSum').parentElement.hidden = true;   // no stale "5/6 checks" from the previous slip
    $('explain').hidden = true;                   // nothing verified to explain
    $('paper').classList.add('retake');
    $('retakeTips').hidden = false;
    // offer the cloud only for a fresh on-device read of a photo we still have
    $('cloudRetry').hidden = !(meta.live && meta.source !== 'in_cloud' && lastBlob && navigator.onLine && !tooPoor());
    stamp('grey', t('stampRetake'));
    show('s-result'); return;
  }
  $('paper').classList.remove('retake');
  $('retakeTips').hidden = true;
  $('cloudRetry').hidden = true;
  $('checksSum').parentElement.hidden = false;
  $('explain').hidden = false;
  const pct = (v) => ((100 * v) / r.gross).toFixed(1) + '%';
  const rows = [`<li class="line sold"><span class="lbl">${t('sold')}</span><i class="dots"></i><span class="amt">${money(r.gross)}</span></li>`];
  for (const d of r.deductions) {
    if (d.rateOk === false) {
      const exp = (r.gross * d.statedRate) / 100, diff = d.amount - exp;
      rows.push(`<li class="line bad"><span class="lbl">${esc(d.label)}</span><i class="dots"></i><span class="amt">−${money(d.amount)}${CIRCLE}</span></li>`
        + `<li class="note">${diff > 0 ? '+' : '−'}${money(Math.abs(diff))} <small>${t('vsRate', { r: d.statedRate })}</small></li>`);
    } else {
      rows.push(`<li class="line"><span class="lbl">${esc(d.label)} <small>${pct(d.amount)}</small></span><i class="dots"></i><span class="amt">−${money(d.amount)}</span></li>`);
    }
  }
  $('lines').innerHTML = rows.join('');
  $('netAmt').textContent = money(r.net);
  const perKg = r.netPerKg ? ` · ${money(r.netPerKg)} / kg` : '';
  $('netSub').textContent = t('ofSale', { p: pct(r.net) }) + perKg;
  const bad = r.deductions.filter((d) => d.rateOk === false);
  const other = r.warnings.filter((w) => !w.id.startsWith('rate:'));
  if (bad.length) stamp('red', bad.length === 1 ? t('stampCheck1') : t('stampCheckN', { n: bad.length }));
  else if (other.length) stamp('amber', t('stampLook'));
  else stamp('green', t('stampChecked'));
  $('alerts').innerHTML = bad.map((d) => {
    const exp = (r.gross * d.statedRate) / 100;
    return `<div class="alert">${t('rateAlert', { label: esc(d.label), r: d.statedRate, gross: money(r.gross), exp: money(exp), amt: money(d.amount) })}</div>`;
  }).join('') + other.map((w) => `<div class="alert">${esc(w.detail)}</div>`).join('');
  $('checksSum').textContent = t('checksPassed', { a: r.checks.filter((c) => c.ok).length, b: r.checks.length });
  $('checks').innerHTML = plainChecks(r).map(([ok, txt]) => `<li class="${ok ? 'ok' : 'no'}"><span>${esc(txt)}</span><b>${ok ? '✓' : '!'}</b></li>`).join('');
  show('s-result');
}

/** The engine's checks, said the way a farmer would check them by hand. */
function plainChecks(r) {
  const out = [];
  for (const i of r.items) {
    const c = r.checks.find((x) => x.id === 'row:' + (i.product || '?'));
    out.push([!c || c.ok || c.minor, `${i.product || t('row')}  ${i.qty.toLocaleString('en-US')} × ${money(i.price)} = ${money(i.amount)}`]);
  }
  const g = r.checks.find((x) => x.id === 'gross');
  if (g) out.push([g.ok, t('rowsAdd', { x: money(r.gross) })]);
  for (const d of r.deductions) if (d.statedRate) {
    out.push([d.rateOk !== false, t('rateCheck', { label: d.label, r: d.statedRate, gross: money(r.gross), exp: money((r.gross * d.statedRate) / 100), amt: money(d.amount) })]);
  }
  const td = r.checks.find((x) => x.id === 'total_deductions');
  if (td) out.push([td.ok, t('dedAdd', { x: money(r.totalDeductions) })]);
  const n = r.checks.find((x) => x.id === 'net');
  if (n) out.push([n.ok, `${money(r.gross)} − ${money(r.totalDeductions)} = ${money(r.net)}`]);
  for (const c of r.checks) if (c.id.startsWith('misread:') || c.id === 'lines') out.push([false, c.detail]);
  return out;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
