// ملف المشروع المحمول (.lawha): أرشيف ZIP فيه manifest.json وصور PNG لكل لوحة.
// يُستخدم للنسخ الاحتياطي ونقل المشروع بين الجوال واللابتوب.
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { isRaster } from './util.js';
import { canvasToBlob, blobToCanvas } from './canvas.js';

export async function exportProjectFile(doc) {
  const files = {};
  let n = 0;
  const ids = new Map();
  async function ser(v) {
    if (v === null || typeof v !== 'object') return v;
    if (isRaster(v)) {
      if (!ids.has(v)) {
        const name = `rasters/${++n}.png`;
        ids.set(v, name);
        const b = await canvasToBlob(v, 'image/png');
        files[name] = new Uint8Array(await b.arrayBuffer());
      }
      return { $file: ids.get(v) };
    }
    if (Array.isArray(v)) {
      const o = [];
      for (const x of v) o.push(await ser(x));
      return o;
    }
    const o = {};
    for (const k of Object.keys(v)) o[k] = await ser(v[k]);
    return o;
  }
  const data = await ser(doc);
  files['manifest.json'] = strToU8(JSON.stringify({ format: 'lawha', version: 1, app: 'لوحة', doc: data }));
  const zip = zipSync(files, { level: 0 });
  return new Blob([zip], { type: 'application/zip' });
}

export async function importProjectFile(blob) {
  const u8 = new Uint8Array(await blob.arrayBuffer());
  const files = unzipSync(u8);
  const man = JSON.parse(strFromU8(files['manifest.json']));
  if (man.format !== 'lawha') throw new Error('ليس ملف مشروع «لوحة»');
  const cache = new Map();
  async function de(v) {
    if (v === null || typeof v !== 'object') return v;
    if (v.$file) {
      if (!cache.has(v.$file)) {
        const { canvas } = await blobToCanvas(new Blob([files[v.$file]], { type: 'image/png' }));
        cache.set(v.$file, canvas);
      }
      return cache.get(v.$file);
    }
    if (Array.isArray(v)) {
      const o = [];
      for (const x of v) o.push(await de(x));
      return o;
    }
    const o = {};
    for (const k of Object.keys(v)) o[k] = await de(v[k]);
    return o;
  }
  return de(man.doc);
}
