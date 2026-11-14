// SlipCheck — read the result aloud, offline. The sentence is built by code from the reconciled numbers
// (never by a model), and spoken by the device's own speech engine.

const T = {
  en: {
    got: (net) => `You received ${net}.`,
    sold: (gross, ded, pct) => `You sold ${gross}. ${ded} was deducted, that is ${pct} percent.`,
    line: (label, amt) => `${label}: ${amt}.`,
    bad: (label, stated, exp, amt) => `Please check ${label}. It says ${stated} percent, which would be ${exp}, but ${amt} was taken.`,
    ok: 'Every line adds up.',
    retake: 'This photo could not be read clearly. Please take it again.',
  },
  ko: {
    got: (net) => `받으신 돈은 ${net}입니다.`,
    sold: (gross, ded, pct) => `판매 금액은 ${gross}이고, 공제된 돈은 ${ded}, ${pct}퍼센트입니다.`,
    line: (label, amt) => `${label}, ${amt}.`,
    bad: (label, stated, exp, amt) => `${label} 항목을 확인해 보세요. ${stated}퍼센트라고 적혀 있어 ${exp}이어야 하는데, ${amt}이 빠졌습니다.`,
    ok: '모든 줄의 계산이 맞습니다.',
    retake: '사진을 정확히 읽지 못했습니다. 다시 찍어 주세요.',
  },
  es: {
    got: (net) => `Usted recibió ${net}.`,
    sold: (gross, ded, pct) => `Vendió ${gross}. Le descontaron ${ded}, es decir, el ${pct} por ciento.`,
    line: (label, amt) => `${label}: ${amt}.`,
    bad: (label, stated, exp, amt) => `Revise ${label}. Dice ${stated} por ciento, que serían ${exp}, pero le cobraron ${amt}.`,
    ok: 'Todas las cuentas cuadran.',
    retake: 'No se pudo leer bien la foto. Por favor, tómela de nuevo.',
  },
  hi: {
    got: (net) => `आपको ${net} मिले।`,
    sold: (gross, ded, pct) => `बिक्री ${gross} की हुई। ${ded} काटे गए, यानी ${pct} प्रतिशत।`,
    line: (label, amt) => `${label}: ${amt}।`,
    bad: (label, stated, exp, amt) => `${label} देखिए। इस पर ${stated} प्रतिशत लिखा है, जो ${exp} होता है, पर ${amt} काटे गए।`,
    ok: 'हर पंक्ति का हिसाब सही है।',
    retake: 'यह फ़ोटो साफ़ नहीं पढ़ी जा सकी। कृपया फिर से लें।',
  },
};
const CUR_WORD = { KRW: { ko: '원', en: 'won', es: 'wones', hi: 'वॉन' }, INR: { en: 'rupees', ko: '루피', es: 'rupias', hi: 'रुपये' },
  MXN: { es: 'pesos', en: 'pesos', ko: '페소', hi: 'पेसो' }, USD: { en: 'dollars', ko: '달러', es: 'dólares', hi: 'डॉलर' } };

export function pickLang(pref = navigator.language || 'en') {
  const l = pref.slice(0, 2).toLowerCase();
  return T[l] ? l : 'en';
}

/** Spoken amount: plain digits + currency word, so any voice reads it naturally. */
function say(n, cur, lang) {
  const dec = cur === 'KRW' ? 0 : (Math.round(n) === n ? 0 : 2);
  const num = n.toLocaleString(lang === 'ko' ? 'ko-KR' : lang === 'es' ? 'es-MX' : lang === 'hi' ? 'en-IN' : 'en-US', { maximumFractionDigits: dec, minimumFractionDigits: dec });
  return `${num} ${(CUR_WORD[cur] || {})[lang] || cur}`;
}

/** Build the sentence list for one reconciled slip. */
export function script(r, cur, lang) {
  const t = T[lang];
  if (!r || r.unreliable || !Number.isFinite(r.net)) return [t.retake];
  const out = [t.got(say(r.net, cur, lang)), t.sold(say(r.gross, cur, lang), say(r.totalDeductions, cur, lang), (100 * r.totalDeductions / r.gross).toFixed(1))];
  for (const d of r.deductions) {
    out.push(t.line(d.label.replace(/[()]/g, ' '), say(d.amount, cur, lang)));
    if (d.rateOk === false) out.push(t.bad(d.label.replace(/\(.*\)/, ''), d.statedRate, say((r.gross * d.statedRate) / 100, cur, lang), say(d.amount, cur, lang)));
  }
  if (r.allClear) out.push(t.ok);
  return out;
}

const LOCALE = { en: 'en', ko: 'ko', es: 'es', hi: 'hi' };
export function speak(lines, lang) {
  if (self.SlipNative) { self.SlipNative.speak(JSON.stringify(lines), lang); return true; } // Android: the phone's TTS
  if (!('speechSynthesis' in self)) return false;
  speechSynthesis.cancel();
  const voices = speechSynthesis.getVoices();
  // prefer a local (offline) voice in that language
  const v = voices.find((x) => x.lang.toLowerCase().startsWith(LOCALE[lang]) && x.localService)
    || voices.find((x) => x.lang.toLowerCase().startsWith(LOCALE[lang]));
  for (const s of lines) {
    const u = new SpeechSynthesisUtterance(s);
    if (v) u.voice = v;
    u.lang = v ? v.lang : lang;
    u.rate = 0.95;
    speechSynthesis.speak(u);
  }
  return true;
}
export const stopSpeaking = () => { try { if (self.SlipNative) self.SlipNative.stopSpeak(); else speechSynthesis.cancel(); } catch (_) {} };
