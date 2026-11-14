// node test/run.mjs  — grades the engine on real model outputs against answers.json
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { reconcile, parseAmount } from '../reconcile.js';
import { RAW, EXPECT_FLAG, PHOTO_RAW, PHOTO_EXPECT_FLAG, RETAKE_RAW } from './fixtures.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const answers = JSON.parse(readFileSync(join(here, 'answers.json'), 'utf8'));
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('  FAIL', msg); } };
const eq = (a, b) => Math.abs(a - b) < 0.005;

// unit tests for the number parser
for (const [s, v, o] of [['1,540,000', 1540000], ['11,100.00', 11100], ['1.200,50', 1200.5], ['Rs. 450', 450], ['7%', 7],
  ['1,150', 1150], ['0.5', 0.5], ['1.540.000', 1540000], ['1.150', 1150, { decimal: ',' }], ['(36,000)', -36000]]) {
  ok(eq(parseAmount(s, o), v), `parseAmount(${s}) = ${parseAmount(s, o)} != ${v}`);
}

const summary = {};
for (const [file, raw] of Object.entries(RAW)) {
  const a = answers[file], r = reconcile(raw);
  const flagged = r.deductions.some((d) => d.rateOk === false);
  console.log(`${file}: salvaged=${r.salvaged} gross=${r.gross} ded=${r.totalDeductions} net=${r.net} netPerKg=${r.netPerKg?.toFixed(1)} flagged=${flagged}`);
  for (const w of r.warnings) console.log('   warn', w.id, '|', w.detail);
  ok(eq(r.gross, a.gross), `${file} gross ${r.gross} != ${a.gross}`);
  ok(eq(r.totalDeductions, a.total_deductions), `${file} deductions ${r.totalDeductions} != ${a.total_deductions}`);
  ok(eq(r.net, a.net), `${file} net ${r.net} != ${a.net}`);
  ok(r.deductions.length === Object.keys(a.deductions).length, `${file} deduction lines ${r.deductions.length} != ${Object.keys(a.deductions).length}`);
  ok(flagged === EXPECT_FLAG[file], `${file} commission flag ${flagged} != ${EXPECT_FLAG[file]}`);
  summary[file] = { salvaged: r.salvaged, gross: r.gross, totalDeductions: r.totalDeductions, net: r.net, netPerKg: r.netPerKg,
    deductionShare: r.deductionShare, flagged, warnings: r.warnings.map((w) => w.detail) };
}
const photoAns = JSON.parse(readFileSync(join(here, 'photo/answers_photo.json'), 'utf8'));
for (const [file, raw] of Object.entries(PHOTO_RAW)) {
  const a = photoAns[file], r = reconcile(raw);
  const flagged = r.deductions.some((d) => d.rateOk === false);
  console.log(`${file}: gross=${r.gross} ded=${r.totalDeductions} net=${r.net} flagged=${flagged} unreliable=${r.unreliable}`);
  for (const w of r.warnings) console.log('   warn', w.id, '|', w.detail);
  ok(eq(r.gross, a.gross) && eq(r.totalDeductions, a.total_deductions) && eq(r.net, a.net), `${file} totals ${r.gross}/${r.totalDeductions}/${r.net} != ${a.gross}/${a.total_deductions}/${a.net}`);
  ok(flagged === PHOTO_EXPECT_FLAG[file], `${file} commission flag ${flagged} != ${PHOTO_EXPECT_FLAG[file]}`);
  ok(!r.unreliable, `${file} marked unreliable`);
  summary[file] = { gross: r.gross, totalDeductions: r.totalDeductions, net: r.net, flagged, warnings: r.warnings.map((w) => w.detail) };
}
for (const [file, raw] of Object.entries(RETAKE_RAW)) {
  const r = reconcile(raw);
  const flagged = r.deductions.some((d) => d.rateOk === false);
  console.log(`${file}: unreliable=${r.unreliable} flagged=${flagged}`);
  ok(r.unreliable, `${file} should ask for a retake`);
  ok(!flagged, `${file} must not accuse any fee`);
}
writeFileSync(join(here, 'last_run.json'), JSON.stringify({ pass, fail, summary }, null, 1));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
