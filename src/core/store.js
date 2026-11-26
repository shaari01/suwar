// التخزين الدائم في IndexedDB: المشاريع، والصور، ومكتبة العناصر، والإعدادات
import { isRaster, uid } from './util.js';
import { canvasToBlob, blobToCanvas } from './canvas.js';

const DB_NAME = 'suwar-lawha';
const DB_VERSION = 1;
let dbp = null;

function openDb() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      if (!db.objectStoreNames.contains('elements')) db.createObjectStore('elements', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

function reqP(r) {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function idbGet(store, key) {
  const db = await openDb();
  return reqP(db.transaction(store).objectStore(store).get(key));
}
export async function idbPut(store, value, key) {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  const r = key === undefined ? tx.objectStore(store).put(value) : tx.objectStore(store).put(value, key);
  return reqP(r);
}
export async function idbDel(store, key) {
  const db = await openDb();
  return reqP(db.transaction(store, 'readwrite').objectStore(store).delete(key));
}
export async function idbAll(store) {
  const db = await openDb();
  return reqP(db.transaction(store).objectStore(store).getAll());
}
export async function idbKeys(store) {
  const db = await openDb();
  return reqP(db.transaction(store).objectStore(store).getAllKeys());
}

// ---------- تسلسل اللوحات ----------
const blobIdOf = new WeakMap(); // canvas -> blobId محفوظ

async function rasterToRef(r, used) {
  let id = blobIdOf.get(r);
  if (!id) {
    id = uid('blob');
    const blob = await canvasToBlob(r, 'image/png');
    await idbPut('blobs', blob, id);
    blobIdOf.set(r, id);
  }
  used.add(id);
  return { $blob: id, w: r.width, h: r.height };
}

async function serialize(v, used) {
  if (v === null || typeof v !== 'object') return v;
  if (isRaster(v)) return rasterToRef(v, used);
  if (ArrayBuffer.isView(v)) return v; // IndexedDB تحفظ المصفوفات الرقمية مباشرة
  if (Array.isArray(v)) {
    const out = [];
    for (const x of v) out.push(await serialize(x, used));
    return out;
  }
  const o = {};
  for (const k of Object.keys(v)) o[k] = await serialize(v[k], used);
  return o;
}

async function deserialize(v) {
  if (v === null || typeof v !== 'object') return v;
  if (ArrayBuffer.isView(v)) return v;
  if (v.$blob) {
    const blob = await idbGet('blobs', v.$blob);
    if (!blob) return null;
    const { canvas } = await blobToCanvas(blob);
    blobIdOf.set(canvas, v.$blob);
    return canvas;
  }
  if (Array.isArray(v)) return Promise.all(v.map(deserialize));
  const o = {};
  for (const k of Object.keys(v)) o[k] = await deserialize(v[k]);
  return o;
}

export async function saveProject(doc, thumbCanvas) {
  const used = new Set();
  const data = await serialize(doc, used);
  const prev = await idbGet('projects', doc.id);
  const thumb = thumbCanvas ? await canvasToBlob(thumbCanvas, 'image/jpeg', 0.8) : prev?.thumb;
  const rec = { id: doc.id, name: doc.name, updated: Date.now(), data, blobs: [...used], thumb };
  await idbPut('projects', rec);
  // حذف الصور التي لم يعد يستخدمها هذا المشروع
  if (prev?.blobs) {
    const stillUsed = await blobsUsedElsewhere(doc.id);
    for (const b of prev.blobs) if (!used.has(b) && !stillUsed.has(b)) await idbDel('blobs', b);
  }
  return rec;
}

async function blobsUsedElsewhere(exceptProjectId) {
  const s = new Set();
  for (const p of await idbAll('projects')) if (p.id !== exceptProjectId) for (const b of p.blobs || []) s.add(b);
  for (const e of await idbAll('elements')) for (const b of e.blobs || []) s.add(b);
  return s;
}

export async function loadProject(id) {
  const rec = await idbGet('projects', id);
  if (!rec) return null;
  return deserialize(rec.data);
}

export async function listProjects() {
  const all = await idbAll('projects');
  return all.map(({ id, name, updated, thumb }) => ({ id, name, updated, thumb })).sort((a, b) => b.updated - a.updated);
}

export async function deleteProject(id) {
  const rec = await idbGet('projects', id);
  await idbDel('projects', id);
  if (rec?.blobs) {
    const stillUsed = await blobsUsedElsewhere(id);
    for (const b of rec.blobs) if (!stillUsed.has(b)) await idbDel('blobs', b);
  }
}

// ---------- مكتبة العناصر ----------
export async function saveElement(el) {
  const used = new Set();
  const data = await serialize({ src: el.src, mask: el.mask }, used);
  const thumb = el.thumbCanvas ? await canvasToBlob(el.thumbCanvas, 'image/png') : null;
  const rec = {
    id: el.id || uid('el'),
    name: el.name,
    category: el.category,
    tags: el.tags || [],
    created: el.created || Date.now(),
    used: el.usedCount || 0,
    width: el.src.width,
    height: el.src.height,
    data,
    blobs: [...used],
    thumb
  };
  await idbPut('elements', rec);
  return rec;
}

export async function listElements() {
  const all = await idbAll('elements');
  return all
    .map(({ id, name, category, tags, created, thumb, width, height, used }) => ({ id, name, category, tags, created, thumb, width, height, used }))
    .sort((a, b) => b.created - a.created);
}

export async function loadElement(id) {
  const rec = await idbGet('elements', id);
  if (!rec) return null;
  const d = await deserialize(rec.data);
  return { ...rec, src: d.src, mask: d.mask };
}

export async function updateElementMeta(id, patch) {
  const rec = await idbGet('elements', id);
  if (!rec) return;
  Object.assign(rec, patch);
  await idbPut('elements', rec);
}

export async function deleteElement(id) {
  const rec = await idbGet('elements', id);
  await idbDel('elements', id);
  if (rec?.blobs) {
    const stillUsed = await blobsUsedElsewhere(null);
    for (const b of rec.blobs) if (!stillUsed.has(b)) await idbDel('blobs', b);
  }
}

// ---------- الإعدادات ----------
export async function getSetting(key, def) {
  try {
    const v = await idbGet('settings', key);
    return v === undefined ? def : v;
  } catch {
    return def;
  }
}
export async function setSetting(key, value) {
  return idbPut('settings', value, key);
}

export async function storageEstimate() {
  if (navigator.storage?.estimate) return navigator.storage.estimate();
  return null;
}

export async function requestPersist() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {}
  return false;
}
