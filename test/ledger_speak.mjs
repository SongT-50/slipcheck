// node test/ledger_speak.mjs — season ledger + spoken script (pure functions)
import { reconcile } from '../reconcile.js';
import { buildLedger, labelKey, issuerKey, sameIssuer } from '../ledger.js';
import { RAW } from './fixtures.mjs';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
globalThis.navigator ??= { language: 'en-US' };
const { script } = await import('../speak.js');

ok(labelKey('위탁수수료(7%)') === labelKey('위탁수수료 (6%)'), 'labelKey ignores rate (ko)');
ok(labelKey('Commission @ 6%') === labelKey('Commission @ 5%'), 'labelKey ignores rate (en)');
ok(issuerKey('Sample Krishi Traders, Shop 14') === issuerKey('Sample Krishi Traders Shop 9'), 'issuerKey ignores shop no.');

ok(sameIssuer(issuerKey('가나청과(주)'), issuerKey('가나첨과(주)')), 'one-char misread merges');
ok(!sameIssuer(issuerKey('가나청과(주)'), issuerKey('다라청과(주)')), 'different agents stay apart');
const ko = reconcile(RAW['slip_ko_mismatch.png']);          // 7% stated, 7.61% taken
const ok7 = reconcile(JSON.parse(JSON.stringify(RAW['slip_ko_mismatch.png']).replace(/181,000/g, '166,600').replace(/337,000/g, '322,600').replace(/2,043,000/g, '2,057,400')));
const rows = [
  { ts: 1, currency: 'KRW|₩', issuer: '가나청과(주)', result: ko },
  { ts: 2, currency: 'KRW|₩', issuer: '다라청과(주)', result: ok7 },
  { ts: 3, currency: 'KRW|₩', issuer: '가나첨과(주)', result: ko },
  { ts: 4, currency: 'KRW|₩', issuer: '가나청과(주)', result: { ...ko, unreliable: true } },   // retake: not counted
  { ts: 5, currency: 'INR|Rs.', issuer: 'X', result: reconcile(RAW['slip_en.png']) },         // other currency
];
const L = buildLedger(rows, 'KRW|₩');
ok(L.count === 3 && L.skipped === 1, `count ${L.count} skipped ${L.skipped}`);
ok(L.gross === 3 * 2380000, `gross ${L.gross}`);
ok(L.deducted === 337000 * 2 + 322600, `deducted ${L.deducted}`);
ok(L.received === L.gross - L.deducted, 'received = gross - deducted');
ok(L.flagged === 2, `flagged ${L.flagged}`);
ok(L.byIssuer.length === 2 && L.byIssuer[0].issuer === '가나청과(주)', 'agent with higher share first');
ok(Math.abs(L.byIssuer[0].share - 337000 / 2380000) < 1e-9, 'agent share');
ok(L.byLabel[0].amount === 181000 * 2 + 166600, `commission total ${L.byLabel[0].amount}`);

const s = script(ko, 'KRW', 'ko');
ok(s[0] === '받으신 돈은 2,043,000 원입니다.', s[0]);
ok(s.some((x) => x.includes('7퍼센트') && x.includes('166,600 원') && x.includes('181,000 원')), 'ko mismatch sentence');
const es = script(reconcile(RAW['slip_es.png']), 'MXN', 'es');
ok(es[0] === 'Usted recibió 13,680 pesos.', es[0]);
ok(script({ ...ko, unreliable: true }, 'KRW', 'en')[0].startsWith('This photo could not'), 'retake sentence');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
