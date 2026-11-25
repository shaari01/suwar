// مشغّل الاختبارات في المتصفح: يبني نسخة، ويشغّل خادم المعاينة، ثم ينفّذ كل ملفات specs
import { spawn } from 'node:child_process';
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const out = join(root, 'test-results');
mkdirSync(out, { recursive: true });
const PORT = 4173;
const base = `http://localhost:${PORT}/`;
const only = process.argv.slice(2);

function startServer() {
  const p = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('server timeout')), 30000);
    p.stdout.on('data', (d) => {
      if (String(d).includes('Local')) {
        clearTimeout(t);
        res(p);
      }
    });
    p.stderr.on('data', (d) => process.stderr.write(d));
  });
}

/** يرسم صورة اختبار داخل المتصفح ويحفظها ملف PNG */
async function fixture(page, kind, w = 800, h = 600) {
  const b64 = await page.evaluate(([kind, w, h]) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    if (kind === 'subject') {
      // خلفية خضراء متدرجة وجسم أحمر في الوسط
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#3a9d4a'); gr.addColorStop(1, '#2d7a39');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = '#d23c2a';
      g.beginPath(); g.ellipse(w / 2, h / 2 + 40, w * 0.16, h * 0.3, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#f0c8a0';
      g.beginPath(); g.arc(w / 2, h / 2 - h * 0.28, h * 0.1, 0, Math.PI * 2); g.fill();
    } else if (kind === 'sky') {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#f6b26b'); gr.addColorStop(0.6, '#8e7cc3'); gr.addColorStop(1, '#2b2b52');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = '#1d1d3a'; g.fillRect(0, h * 0.75, w, h * 0.25);
    } else if (kind === 'checker') {
      for (let y = 0; y < h; y += 50) for (let x = 0; x < w; x += 50) { g.fillStyle = ((x + y) / 50) % 2 ? '#222' : '#eee'; g.fillRect(x, y, 50, 50); }
    } else {
      g.fillStyle = kind; g.fillRect(0, 0, w, h);
    }
    return c.toDataURL('image/png').split(',')[1];
  }, [kind, w, h]);
  const p = join(out, `fx-${kind.replace('#', '')}-${w}x${h}.png`);
  writeFileSync(p, Buffer.from(b64, 'base64'));
  return p;
}

try { (await import('node:child_process')).execSync('pkill -f "vite preview"'); } catch {}
const server = await startServer();
const browser = await chromium.launch();
let failed = 0;
const files = readdirSync(join(here, 'specs')).filter((f) => f.endsWith('.mjs') && (!only.length || only.some((o) => f.includes(o)))).sort();
for (const f of files) {
  const mod = await import(join(here, 'specs', f));
  for (const [name, fn] of Object.entries(mod.tests)) {
    const ctx = await browser.newContext({ viewport: mod.viewport || { width: 1366, height: 768 }, deviceScaleFactor: 1, hasTouch: !!mod.touch, isMobile: !!mod.mobile });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    const t0 = Date.now();
    try {
      await page.goto(base);
      await page.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 20000 });
      await fn({ page, ctx, base, assert, fixture: (k, w, h) => fixture(page, k, w, h), shot: (n) => page.screenshot({ path: join(out, `${f.replace('.mjs', '')}-${n}.png`) }), out });
      const bad = errors.filter((e) => !/favicon|Failed to load resource/.test(e));
      if (bad.length) throw new Error('أخطاء في الصفحة: ' + bad.join(' | '));
      console.log(`✓ ${f} › ${name} (${Date.now() - t0}ms)`);
    } catch (e) {
      failed++;
      console.log(`✗ ${f} › ${name}\n   ${e.stack || e.message}`);
      await page.screenshot({ path: join(out, `FAIL-${f}-${name}.png`) }).catch(() => {});
    }
    await ctx.close();
  }
}
await browser.close();
server.kill();
console.log(failed ? `\n${failed} اختبار فشل` : '\nكل اختبارات المتصفح نجحت');
process.exit(failed ? 1 : 0);
