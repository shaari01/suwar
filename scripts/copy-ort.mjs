// ينسخ ملفات onnxruntime-web (WASM) إلى public/ort قبل البناء حتى تعمل بلا إنترنت
import { mkdirSync, copyFileSync } from 'node:fs';
mkdirSync('public/ort', { recursive: true });
for (const f of ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']) copyFileSync(`node_modules/onnxruntime-web/dist/${f}`, `public/ort/${f}`);
