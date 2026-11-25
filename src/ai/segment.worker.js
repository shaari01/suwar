// عامل خلفي يشغّل نموذج U²-Net الصغير (u2netp، رخصة Apache-2.0) داخل المتصفح بلا إنترنت
import * as ort from 'onnxruntime-web/wasm';

let session = null;
let loading = null;

async function load(base) {
  if (session) return session;
  if (loading) return loading;
  ort.env.wasm.wasmPaths = base + 'ort/';
  ort.env.wasm.numThreads = 1; // GitHub Pages لا يدعم العزل المطلوب للخيوط المتعددة
  ort.env.wasm.proxy = false;
  loading = (async () => {
    const res = await fetch(base + 'models/u2netp.onnx');
    if (!res.ok) throw new Error('تعذّر تحميل نموذج القص');
    const buf = await res.arrayBuffer();
    session = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    return session;
  })();
  return loading;
}

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

self.onmessage = async (e) => {
  const { id, type, base, data, size } = e.data;
  try {
    if (type === 'warmup') {
      await load(base);
      self.postMessage({ id, ok: true });
      return;
    }
    const s = await load(base);
    const S = size;
    const n = S * S;
    // تطبيع مثل rembg: القسمة على أكبر قيمة ثم الطرح والقسمة
    let max = 1;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > max) max = data[i];
      if (data[i + 1] > max) max = data[i + 1];
      if (data[i + 2] > max) max = data[i + 2];
    }
    const input = new Float32Array(3 * n);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      for (let k = 0; k < 3; k++) input[k * n + i] = (data[j + k] / max - MEAN[k]) / STD[k];
    }
    const feeds = { [s.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, S, S]) };
    const out = await s.run(feeds);
    const pred = out[s.outputNames[0]].data;
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = 0; i < n; i++) {
      if (pred[i] < mn) mn = pred[i];
      if (pred[i] > mx) mx = pred[i];
    }
    const sal = new Float32Array(n);
    const d = mx - mn || 1;
    for (let i = 0; i < n; i++) sal[i] = (pred[i] - mn) / d;
    self.postMessage({ id, ok: true, sal }, [sal.buffer]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message ? err.message : err) });
  }
};
