// SlipCheck — on-device history (IndexedDB). Slips never leave the device.
// Every call is wrapped so the app still works when storage is blocked (private window etc.).

const DB = 'slipcheck', STORE = 'slips';
let dbp = null;

function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

function run(mode, fn) {
  return db().then((d) => new Promise((res, rej) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => res(req && 'result' in req ? req.result : undefined);
    t.onerror = () => rej(t.error);
  }));
}

/** Small JPEG thumbnail so history stays light. */
export async function thumbnail(blob, w = 240) {
  try {
    const bmp = await createImageBitmap(blob);
    const h = Math.round((bmp.height / bmp.width) * w);
    const c = new OffscreenCanvas(w, h);
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    return await c.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
  } catch (_) { return null; }
}

export async function saveSlip(rec) {
  try { return await run('readwrite', (s) => s.add({ ...rec, ts: Date.now() })); }
  catch (_) { return null; }
}

export async function updateSlip(id, patch) {
  try {
    const cur = await run('readonly', (s) => s.get(id));
    if (cur) await run('readwrite', (s) => s.put({ ...cur, ...patch }));
  } catch (_) {}
}

export async function listSlips(limit = 20) {
  try {
    const all = (await run('readonly', (s) => s.getAll())) || [];
    return all.sort((a, b) => b.ts - a.ts).slice(0, limit);
  } catch (_) { return []; }
}

export async function clearSlips() {
  try { await run('readwrite', (s) => s.clear()); } catch (_) {}
}
