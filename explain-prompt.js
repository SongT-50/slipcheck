// The "explain" prompt, shared by the web (firebase.js) and the Android app (native.js).
// Only the deduction labels go in — never the photo, never the amounts.
export function explainPrompt(labels, lang = 'en') {
  return `Language: BCP-47 "${lang}". A farmer is reading a produce consignment settlement slip. Write plain everyday words, speaking to the farmer as "you". ` +
    'total_sale, you_received, share: short labels (2-5 words) in that language. ' +
    'meanings: for each deduction label below, in the same order, a few words on what that kind of charge usually pays for. ' +
    'Do not repeat the label, do not mention amounts or percentages, do not say whether it is fair, legal or normal. ' +
    'mismatch: one or two sentences in that language that keep the placeholders {stated}, {expected} and {charged} exactly, meaning: ' +
    '"The slip says {stated}, which would be {expected} of your total sale, but {charged} was taken. Ask the company that issued the slip how it was calculated." ' +
    'Deduction labels: ' + JSON.stringify(labels);
}
