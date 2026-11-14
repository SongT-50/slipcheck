// SlipCheck — photo orientation. Gemini Nano cannot read sideways text: on a sideways handwritten slip it
// invented a whole different slip whose numbers still added up (2026-11-14), so arithmetic could not catch it.
// The model also cannot tell left from right. So: guess "sideways" from the table lines, turn it, and let the
// user confirm with one tap before anything is read.

/** Quarter turns clockwise (0..3) that the image most likely needs. Only detects sideways (returns 0 or 3). */
export function guessTurns(bmp) {
  const k = Math.min(1, 800 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const c = new OffscreenCanvas(w, h);
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(bmp, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2];
  // long straight edges: rows (or columns) where more than a quarter of the pixels sit on a strong edge
  let rows = 0, cols = 0;
  for (let y = 0; y < h - 1; y++) {
    let n = 0;
    for (let i = 0; i < w; i++) if (Math.abs(g[(y + 1) * w + i] - g[y * w + i]) > 35) n++;
    if (n > 0.25 * w) rows++;
  }
  for (let i = 0; i < w - 1; i++) {
    let n = 0;
    for (let y = 0; y < h; y++) if (Math.abs(g[y * w + i + 1] - g[y * w + i]) > 35) n++;
    if (n > 0.25 * h) cols++;
  }
  // table lines run along the text: mostly vertical lines => the slip is lying sideways.
  // Default to a counter-clockwise turn (title on the right edge — how both of our test photos came out).
  return cols >= 3 && cols > 2 * rows ? 3 : 0;
}

/** Rotate by quarter turns clockwise and return a JPEG blob. */
export async function turn(bmp, turns) {
  const t = ((turns % 4) + 4) % 4;
  const side = t % 2 === 1;
  const c = new OffscreenCanvas(side ? bmp.height : bmp.width, side ? bmp.width : bmp.height);
  const x = c.getContext('2d');
  x.translate(c.width / 2, c.height / 2);
  x.rotate((t * Math.PI) / 2);
  x.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
}

/**
 * Photo quality hint, measured on a 640px greyscale copy (same method as the calibration on 11/14):
 * sharpness = variance of the Laplacian. Real phone photos measured 941–1,561, mildly blurred tests 504–628 (read fine),
 * heavily blurred tests 52–89 (mostly asked for a retake) → "blurry" below 200.
 * brightness = mean grey. No dark photo in the test set yet, so "dark" only below 110 (darkest test was 124).
 * A hint only: it never blocks reading.
 */
export function photoQuality(bmp) {
  const k = 640 / Math.max(bmp.width, bmp.height);
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const c = new OffscreenCanvas(w, h);
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(bmp, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  let sum = 0;
  for (let i = 0; i < w * h; i++) { g[i] = 0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2]; sum += g[i]; }
  let n = 0, m = 0, m2 = 0;
  for (let y = 1; y < h - 1; y++) for (let i = 1; i < w - 1; i++) {
    const p = y * w + i, v = 4 * g[p] - g[p - w] - g[p + w] - g[p - 1] - g[p + 1];
    n++; m += v; m2 += v * v;
  }
  const sharpness = n ? m2 / n - (m / n) ** 2 : 0, brightness = sum / (w * h);
  return { sharpness, brightness, blurry: sharpness < 200, dark: brightness < 110 };
}
