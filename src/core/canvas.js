// أدوات لوحات الرسم في المتصفح

export function mk(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function ctx2d(c, opts) {
  return c.getContext('2d', { willReadFrequently: false, ...opts });
}

export function cloneCanvas(src) {
  const c = mk(src.width, src.height);
  ctx2d(c).drawImage(src, 0, 0);
  return c;
}

export function getData(c) {
  return c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
}

/** يحوّل كائنًا {width,height,data} إلى لوحة رسم */
export function fromData(img) {
  const c = mk(img.width, img.height);
  const id = img instanceof ImageData ? img : new ImageData(new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.length), img.width, img.height);
  ctx2d(c).putImageData(id, 0, 0);
  return c;
}

/** قناع رمادي (Uint8 بقيمة لكل بكسل) إلى لوحة ألفا (أبيض بشفافية = القناع) */
export function maskToCanvas(alpha, w, h) {
  const img = new ImageData(w, h);
  const d = img.data;
  for (let i = 0, j = 0; i < alpha.length; i++, j += 4) {
    d[j] = 255;
    d[j + 1] = 255;
    d[j + 2] = 255;
    d[j + 3] = alpha[i];
  }
  const c = mk(w, h);
  ctx2d(c).putImageData(img, 0, 0);
  return c;
}

/** لوحة قناع إلى مصفوفة ألفا */
export function canvasToMask(c) {
  const d = getData(c).data;
  const a = new Uint8Array(c.width * c.height);
  for (let i = 0, j = 3; i < a.length; i++, j += 4) a[i] = d[j];
  return a;
}

export function alphaOf(c) {
  return canvasToMask(c);
}

export function filledMask(w, h, value = 255) {
  const c = mk(w, h);
  const g = ctx2d(c);
  g.fillStyle = `rgba(255,255,255,${value / 255})`;
  g.fillRect(0, 0, w, h);
  return c;
}

export function canvasToBlob(c, type = 'image/png', quality) {
  return new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error('تعذّر إنشاء الملف'))), type, quality)
  );
}

export async function blobToCanvas(blob, maxSide = Infinity) {
  let bmp;
  try {
    bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    bmp = await new Promise((res, rej) => {
      const url = URL.createObjectURL(blob);
      const im = new Image();
      im.onload = () => {
        URL.revokeObjectURL(url);
        res(im);
      };
      im.onerror = () => {
        URL.revokeObjectURL(url);
        rej(new Error('صيغة الصورة غير مدعومة'));
      };
      im.src = url;
    });
  }
  const w0 = bmp.width;
  const h0 = bmp.height;
  const s = Math.min(1, maxSide / Math.max(w0, h0));
  const c = mk(w0 * s, h0 * s);
  const g = ctx2d(c);
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, c.width, c.height);
  if (bmp.close) bmp.close();
  return { canvas: c, scaled: s < 1, originalWidth: w0, originalHeight: h0 };
}

/** الحد الأعلى للدقة حسب ذاكرة الجهاز (قرار موثّق في DECISIONS.md) */
export function deviceMaxSide() {
  const mem = navigator.deviceMemory || 4;
  if (mem <= 2) return 3072;
  if (mem <= 4) return 4096;
  return 6000;
}

/** يحدّ مستطيل الحدود للبكسلات غير الشفافة */
export function opaqueBounds(c, threshold = 8) {
  const d = getData(c).data;
  const w = c.width;
  const h = c.height;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function cropCanvas(c, r) {
  const o = mk(r.w, r.h);
  ctx2d(o).drawImage(c, -r.x, -r.y);
  return o;
}

export function thumbnail(c, size = 96) {
  const s = Math.min(1, size / Math.max(c.width, c.height));
  const t = mk(Math.max(1, c.width * s), Math.max(1, c.height * s));
  const g = ctx2d(t);
  g.imageSmoothingQuality = 'high';
  g.drawImage(c, 0, 0, t.width, t.height);
  return t;
}
