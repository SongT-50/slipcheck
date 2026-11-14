// read-aloud clip plan: numbers spoken right, every clip id exists as a recorded file
import { readFileSync, existsSync } from 'node:fs';
import { numberClips, plan, labelClip } from '../voice.js';
const T = JSON.parse(readFileSync(new URL('../voice/clips.json', import.meta.url), 'utf8'));
let pass = 0, fail = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; if (!ok) console.log('FAIL', name, got, want); };
const say = (ids, lang) => ids.map((i) => ({ ...T[lang].numbers })[i]).join(' ');
eq('ko 2,043,000', say(numberClips(2043000, 'ko'), 'ko'), '이백 사 만 삼천');
eq('ko 24', say(numberClips(24, 'ko'), 'ko'), '이십사');
eq('ko 10,000', say(numberClips(10000, 'ko'), 'ko'), '만');
eq('ko 100,000,000', say(numberClips(100000000, 'ko'), 'ko'), '일 억');
eq('ko 13.9', say(numberClips(13.9, 'ko', 1), 'ko'), '십삼 점 구');
eq('ko 0', say(numberClips(0, 'ko'), 'ko'), '영');
eq('en 46,185', say(numberClips(46185, 'en'), 'en'), 'forty-six thousand one hundred eighty-five');
eq('en 52,500.50', say(numberClips(52500.5, 'en', 2), 'en'), 'fifty-two thousand five hundred point five');
eq('en 1,000,019', say(numberClips(1000019, 'en'), 'en'), 'one million nineteen');
eq('label ko', labelClip('위탁수수료(7%)', T.ko), 'l_commission');
eq('label ko 2', labelClip('지역수수료(7%)', T.ko), 'l_fee');
eq('label en', labelClip('Hamali (labour)', T.en), 'l_hamali');
eq('label en unloading', labelClip('Unloading', T.en), 'l_unloading');
eq('label other', labelClip('Something odd', T.en), 'l_other');
eq('english label, korean voice', labelClip('Commission 6%', T.ko), 'l_commission');
eq('english hamali, korean voice', labelClip('Hamali (labour)', T.ko), 'l_handling');
eq('korean label, english voice', labelClip('운송비', T.en), 'l_transport');
eq('market fee ko', labelClip('Market fee @ 1%', T.ko), 'l_market');
const r = { net: 2043000, gross: 2380000, totalDeductions: 337000, allClear: false,
  deductions: [{ label: '위탁수수료(7%)', amount: 181000, rateOk: false }, { label: '하역비', amount: 36000 }, { label: '운송비', amount: 120000 }] };
for (const lang of ['ko', 'en']) for (const cur of ['KRW', 'INR']) {
  const ids = plan(r, cur, lang, T[lang]).filter((i) => i !== '|');
  const missing = ids.filter((i) => !existsSync(new URL(`../voice/${lang}/${i}.mp3`, import.meta.url)));
  eq(`all clips recorded ${lang} ${cur}`, missing, []);
}
eq('retake', plan({ unreliable: true }, 'KRW', 'ko', T.ko), ['p_retake']);
console.log(`${pass} passed, ${fail} failed`);
