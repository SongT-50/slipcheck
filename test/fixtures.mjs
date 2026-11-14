// Real on-device model outputs (Chrome Prompt API / Gemini Nano, 2026-11-14), copied verbatim from the test page.
// slip_es: the model broke the JSON, then streamed whitespace until the 150 s cut-off.
export const RAW = {
  'slip_en.png': '{"currency": "Rs.", "items": [{"product": "Tomato", "unit": "crate 25 kg", "qty": "40", "unit_price": "450", "amount": "18,000"}, {"product": "Onion", "unit": "bag 50 kg", "qty": "30", "unit_price": "1,150", "amount": "34,500"}], "gross": "52,500", "deductions": [{"label": "Commission @ 6%", "rate_pct": "6", "amount": "3,150"}, {"label": "Market fee @ 1%", "rate_pct": "1", "amount": "525"}, {"label": "Hamali (labour)", "rate_pct": "0", "amount": "700"}, {"label": "Weighing", "rate_pct": "0", "amount": "140"}, {"label": "Transport", "rate_pct": "0", "amount": "1,800"}], "total_deductions": "6,315", "net": "46,185"}',
  'slip_es.png': '{"currency": "USD", "items": [{"product": "Tomate saladette", "unit": "caja 20 kg", "qty": "60", "unit_price": "185.00", "amount": "11,100.00"}, {"product": "Chile serrano", "unit": "caja 10 kg", "qty": "25", "unit_price": "240.00", "amount": "6,000.00"}], "gross": "17,100.00", "deductions": [{"label": "Comisión 10%", "rate_pct": "10%", "amount": "1,710.00"}, {"label": "Maniobras (descarga)", "rate_pct": "0%", "amount": "510.00"}, {"label": "Flete", "rate_pct": "0%", "amount": "1,200.00}], "\t,"gross": "17,100.00", "deductions": [{"label": "Total deducciones", "rate_pct": "0%", "amount": "3,420.00"}], "total_deductions": "3,420.00", "net": "13,680.00"}\n\n\n\n\n \n \n\n \n\n \n\n \n\n \n',
  'slip_ko_mismatch.png': '{"currency": "원", "items": [{"product": "사과(부사)", "unit": "10kg", "qty": "40", "unit_price": "38,500", "amount": "1,540,000"}, {"product": "배(신고)", "unit": "15kg", "qty": "20", "unit_price": "42,000", "amount": "840,000"}], "gross": "2,380,000", "deductions": [{"label": "위탁수수료(7%)", "rate_pct": "7%", "amount": "181,000"}, {"label": "하역비", "amount": "36,000"}, {"label": "운송비", "amount": "120,000"}, {"label": "공제 합계", "amount": "337,000"}, {"label": "차감 정산액", "amount": "2,043,000"}], "total_deductions": "2,043,000", "net": "0"}',
};
// Expected verdict on the commission line: the mismatch slip must be flagged, the others must not.
export const EXPECT_FLAG = { 'slip_en.png': false, 'slip_es.png': false, 'slip_ko_mismatch.png': true };

// Photo-like / handwritten test images (slips/make_photo_tests.py), read through Firebase AI Logic on-device, 2026-11-14.
// Each one failed the first engine and drove a repair rule.
export const PHOTO_RAW = {
  // 11,100 misread as 6,000 (copied from the next row) -> rule 1b
  'photo_mild_slip_es.jpg': '{"items":[{"product":"Tomate saladette","unit":"caja 20 kg","qty":"60","unit_price":"185.00","amount":"6,000.00"},{"product":"Chile serrano","unit":"caja 10 kg","qty":"25","unit_price":"240.00","amount":"6,000.00"}],"gross":"17,100.00","deductions":[{"label":"Comisión 10%","rate_pct":"10","amount":"1,710.00"},{"label":"Maniobras (descarga)","rate_pct":"","amount":"510.00"},{"label":"Flete","rate_pct":"","amount":"1,200.00"}],"total_deductions":"3,420.00","net":"13,680.00"}',
  // Transport 1,800 read as 46,400 (copied from Net paid) -> rule 3c; the real 6% overcharge must stay flagged
  'hw_en_mismatch.jpg': '{"items":[{"product":"Tomato","unit":"40 x 450","qty":"40","unit_price":"450","amount":"18,000"}, {"product":"Onion","unit":"30 x 1,150","qty":"30","unit_price":"1,150","amount":"34,500"}],"gross":"52,500","deductions":[{"label":"Commission 6%","rate_pct":"6","amount":"3,600"}, {"label":"Hamali","rate_pct": "", "amount":"700"}, {"label":"Transport","rate_pct": "", "amount":"46,400"}],"total_deductions":"50,700","net":"46,400"}',
  // reconstructed from the hard Korean photo: 166,600 read as 166,000 -> rule 3b (printed totals agree with gross)
  'photo_hard_slip_ko.jpg': '{"items":[{"product":"사과(무사)","unit":"10kg","qty":"40","unit_price":"38,500","amount":"1,540,000"},{"product":"배(신고)","unit":"15kg","qty":"20","unit_price":"42,000","amount":"840,000"}],"gross":"2,380,000","deductions":[{"label":"지역수수료(7%)","rate_pct":"7","amount":"166,000"},{"label":"하역비","rate_pct":"0","amount":"36,000"},{"label":"준비비","rate_pct":"0","amount":"120,000"},{"label":"공제 합계","amount":"322,600"}],"total_deductions":"322,600","net":"2,057,400"}',
};
export const PHOTO_EXPECT_FLAG = { 'photo_mild_slip_es.jpg': false, 'hw_en_mismatch.jpg': true, 'photo_hard_slip_ko.jpg': false };

// Rows shifted by one on a hard photo: 525 vanished, every amount moved up a line, totals invented (46,155 / 6,345).
// Must NOT accuse the 1% market fee; must ask for a retake.
export const RETAKE_RAW = {
  'photo_hard_slip_en.jpg': '{"items":[{"product":"Produce","unit":"Unit","qty":"40","unit_price":"450","amount":"18,000"},{"product":"Tomato","unit":"crate 25 kg","qty":"30","unit_price":"1,150","amount":"34,500"},{"product":"Onion","unit":"bag 50 kg","qty":"-","unit_price":"-","amount":"-"}],"gross":"52,500","deductions":[{"label":"Commission @ 6%","rate_pct":"6","amount":"3,150"},{"label":"Market fee @ 1%","rate_pct":"1","amount":"700"},{"label":"Hamal (labour)","rate_pct":"-","amount":"140"},{"label":"Weighing","rate_pct":"-","amount":"1,800"},{"label":"Transport","rate_pct":"-","amount":"6,315"}],"total_deductions":"46,155","net":"6,345"}',
};

// Fake rates: the model filled rate_pct with the amount in thousands ("36" for 36,000). Only the real 7% may be flagged.
PHOTO_RAW['photo_mild_slip_ko_mismatch.jpg'] = JSON.stringify({ items: [{ product: '사과(부사)', unit: '10kg', qty: '40', unit_price: '38,500', amount: '1,540,000' }, { product: '배(신고)', unit: '15kg', qty: '20', unit_price: '42,000', amount: '840,000' }], gross: '2,380,000', deductions: [{ label: '위탁수수료(7%)', rate_pct: '7', amount: '181,000' }, { label: '하역비', rate_pct: '36', amount: '36,000' }, { label: '운송비', rate_pct: '120', amount: '120,000' }, { label: '공제 합계', rate_pct: '337', amount: '337,000' }, { label: '차감 정산액', rate_pct: '2,043', amount: '2,043,000' }], total_deductions: '2,043,000', net: '0' });
PHOTO_EXPECT_FLAG['photo_mild_slip_ko_mismatch.jpg'] = true;

// Real phone photo (printed Korean mismatch slip, tilted, keyboard behind): 공제 합계 337,000 read as 33,700. Rule 3a.
PHOTO_RAW['real_4.jpg'] = '{"items":[{"product":"사과(부사)","unit":"10kg","qty":"40","unit_price":"38,500","amount":"1,540,000"},{"product":"배(신고)","unit":"15kg","qty":"20","unit_price":"42,000","amount":"840,000"}],"gross":"2,380,000","deductions":[{"label":"위탁수수료(7%)","rate_pct":"7","amount":"181,000"},{"label":"하역비","rate_pct":"","amount":"36,000"},{"label":"운송비","rate_pct":"","amount":"120,000"},{"label":"공제 합계","rate_pct":"","amount":"33,700"},{"label":"차감 정산액","rate_pct":"","amount":"2,043,000"}],"total_deductions":"2,043,000","net":"0"}';
PHOTO_EXPECT_FLAG['real_4.jpg'] = true;

// A misread net that happens to equal gross − the first two fees (52,500 − 3,150 − 525 = 48,825). Rule 3a must NOT
// drop the three real fee lines after it. Seen when two half-photo reads were merged (strip test, 11/14).
RETAKE_RAW['merged_wrong_net'] = '{"items":[{"product":"Tomato","unit":"crate 25 kg","qty":"40","unit_price":"450","amount":"18,000"},{"product":"Onion","unit":"bag 50 kg","qty":"30","unit_price":"1,150","amount":"34,500"}],"gross":"52,500","deductions":[{"label":"Commission @ 6%","rate_pct":"6","amount":"3,150"},{"label":"Market fee @ 1%","rate_pct":"1","amount":"525"},{"label":"Hamali (labour)","amount":"700"},{"label":"Weighing","amount":"140"},{"label":"Transport","amount":"1,800"}],"total_deductions":"","net":"48,825"}';
