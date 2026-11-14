// SlipCheck — read-aloud in one natural recorded voice, offline.
// The clips (numbers, currency words, fixed phrases, common deduction names) were recorded once
// (tools/make_voice.py) and ship with the app. Here code decides what to say — from the reconciled
// numbers, never from a model — and joins the clips on the device. No voice service is called.

let table = null;
let ctx = null;          // the AudioContext of the reading in progress
const buffers = new Map();

async function clips() {
  if (!table) table = await (await fetch('voice/clips.json')).json();
  return table;
}

// ---- numbers as clip ids ----
function koGroup(g) {           // 1..9999
  const out = [], th = Math.floor(g / 1000), h = Math.floor((g % 1000) / 100), t = Math.floor((g % 100) / 10), u = g % 10;
  if (th) out.push('x1000_' + th);
  if (h) out.push('x100_' + h);
  if (g % 100) out.push('k' + (g % 100));   // 1-99 recorded as whole words ("이십사")
  return out;
}
// Korean clips are cut from whole sentences (tools/make_voice_ko.py); each number unit has two takes:
// _p (more of the number follows) and _f (the number ends here), so the tone runs on like speech.
function koUnits(n) {
  if (n === 0) return ['dd0'];
  const eok = Math.floor(n / 1e8), man = Math.floor((n % 1e8) / 1e4), rest = n % 1e4, out = [];
  if (eok) out.push(...koGroup(eok), 'eok');
  if (man) out.push(...(man === 1 ? [] : koGroup(man)), 'man');
  if (rest) out.push(...koGroup(rest));
  return out.map((u, i) => u + (i === out.length - 1 ? '_f' : '_p'));
}
function koInt(n) {
  if (n === 0) return ['d0'];
  const eok = Math.floor(n / 1e8), man = Math.floor((n % 1e8) / 1e4), rest = n % 1e4, out = [];
  if (eok) out.push(...koGroup(eok), 'eok');
  if (man) out.push(...(man === 1 ? [] : koGroup(man)), 'man');   // 10,000 is "만", not "일만"
  if (rest) out.push(...koGroup(rest));
  return out;
}
function enUnder1000(x) {
  const out = [], h = Math.floor(x / 100), r = x % 100;
  if (h) out.push('w' + h, 'hundred');
  if (r) out.push('e' + r);                  // 1-99 recorded as whole words ("forty-six")
  return out;
}
function enInt(n) {
  if (n === 0) return ['w0'];
  const out = [];
  for (const [size, word] of [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']]) {
    const c = Math.floor(n / size);
    if (c) { out.push(...enUnder1000(c), word); n %= size; }
  }
  if (n) out.push(...enUnder1000(n));
  return out;
}
/** A number as clip ids; decimals are read digit by digit ("point five zero" → trailing zeros dropped). */
export function numberClips(n, lang, decimals = 0) {
  const s = Math.abs(n).toFixed(decimals);
  const [i, f = ''] = s.split('.');
  const ids = lang === 'ko' ? koUnits(Number(i)) : enInt(Number(i));
  const frac = f.replace(/0+$/, '');
  if (frac) {
    ids.push('point');
    for (const d of frac) ids.push(lang === 'ko' ? 'dd' + d : 'w' + d);
  }
  return ids;
}

function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z가-힣]/g, ''); }
/** The recorded name for a deduction label, in the screen language, whatever language the slip is in:
 * the longest known name it contains, otherwise "another deduction". */
export function labelClip(label, T) {
  const n = norm(label);
  let best = 'l_other', len = 0;
  for (const [id, [keys]] of Object.entries(T.labels)) {
    for (const key of keys) if (n.includes(key) && key.length > len) { best = id; len = key.length; }
  }
  return best;
}

/** What to say, as clip ids ('|' = a short pause between sentences). Mirrors speak.js script(). */
export function plan(r, cur, lang, T) {
  if (!r || r.unreliable || !Number.isFinite(r.net)) return ['p_retake'];
  const dec = (n) => (cur === 'KRW' || Math.round(n) === n ? 0 : 2);
  const amt = (n) => [...numberClips(n, lang, dec(n)), ...(T.currency['c_' + cur] ? ['c_' + cur] : [])];
  const pct = numberClips(Number(((100 * r.totalDeductions) / r.gross).toFixed(1)), lang, 1);
  const out = [];
  if (lang === 'ko') {
    const c = ['KRW', 'INR', 'MXN', 'USD'].includes(cur) ? cur : 'KRW';
    const num = (n) => numberClips(n, lang, dec(n));
    out.push('p_got', ...num(r.net), `c_${c}_end`, '|', 'p_sold', ...num(r.gross), `c_${c}_end`, '|',
      'p_ded', ...num(r.totalDeductions), `c_${c}_end`, '|', 'p_pct_pre', ...pct, 'p_pct', '|');
    for (const d of r.deductions) {
      out.push(labelClip(d.label, T), ...num(d.amount), `c_${c}_list`, '|');
      if (d.rateOk === false) out.push(labelClip(d.label, T), 'p_bad', '|');
    }
  } else {
    out.push('p_got', ...amt(r.net), '|', 'p_sold', ...amt(r.gross), '|',
      ...amt(r.totalDeductions), 'p_ded', ...pct, 'p_pct', '|');
    for (const d of r.deductions) {
      out.push(labelClip(d.label, T), ...amt(d.amount), '|');
      if (d.rateOk === false) out.push('p_check', labelClip(d.label, T), '|', 'p_bad', '|');
    }
  }
  if (r.allClear) out.push('p_ok');
  return out;
}

async function buffer(lang, id) {
  const k = lang + '/' + id;
  if (!buffers.has(k)) {
    const data = await (await fetch(`voice/${lang}/${id}.mp3`)).arrayBuffer();
    buffers.set(k, await ctx.decodeAudioData(data));
  }
  return buffers.get(k);
}

/** Read one slip aloud in the recorded voice. Returns false when this language has no recorded voice. */
export async function speakClips(r, cur, lang) {
  if (!['ko', 'en'].includes(lang)) return false;
  stopClips();
  // open the audio while still inside the tap (phones allow sound only from a user gesture)
  const my = ctx = new (self.AudioContext || self.webkitAudioContext)();
  my.resume().catch(() => {});
  const T = (await clips())[lang];
  if (!T) { stopClips(); return false; }
  const ids = plan(r, cur, lang, T);
  try {
    const bufs = [];
    for (const id of ids) bufs.push(id === '|' ? null : await buffer(lang, id));
    if (ctx !== my) return true;                        // stopped while loading
    let at = my.currentTime + 0.05;
    for (const b of bufs) {
      if (!b) { at += 0.32; continue; }                   // between sentences
      const s = my.createBufferSource(); s.buffer = b; s.connect(my.destination); s.start(at);
      at += b.duration - 0.01;                            // words run on, as in speech
    }
  } catch (e) {
    console.warn('voice clips failed', e);
    stopClips();
    return false;
  }
  return true;
}

export function stopClips() {
  if (ctx) { const c = ctx; ctx = null; c.close().catch(() => {}); }
}
