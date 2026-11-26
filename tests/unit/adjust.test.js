import { describe, it, expect } from 'vitest';
import { curveLUT, levelsLUT, applyBasic, applyCurves, applyHSL, parseCube, applyLUT3D, applyColorBalance } from '../../src/img/adjust.js';

const px = (...c) => Uint8ClampedArray.from([...c, 255]);

describe('Curves', () => {
  it('الخط المستقيم لا يغيّر شيئًا', () => {
    const l = curveLUT([[0, 0], [255, 255]]);
    for (let i = 0; i < 256; i += 17) expect(l[i]).toBe(i);
  });
  it('منحنى S يزيد التباين ويبقى رتيبًا', () => {
    const l = curveLUT([[0, 0], [64, 40], [192, 215], [255, 255]]);
    expect(l[64]).toBe(40);
    expect(l[192]).toBe(215);
    for (let i = 1; i < 256; i++) expect(l[i]).toBeGreaterThanOrEqual(l[i - 1]);
  });
  it('منحنى قناة الأحمر فقط', () => {
    const d = px(100, 100, 100);
    applyCurves(d, { r: [[0, 0], [100, 200], [255, 255]] });
    expect(d[0]).toBe(200);
    expect(d[1]).toBe(100);
  });
});

describe('Levels', () => {
  it('النقطة السوداء والبيضاء', () => {
    const l = levelsLUT({ inBlack: 50, inWhite: 200 });
    expect(l[50]).toBe(0);
    expect(l[200]).toBe(255);
    expect(l[125]).toBeGreaterThan(120);
    expect(l[125]).toBeLessThan(135);
  });
});

describe('الأساسية والتشبع', () => {
  it('التعريض يفتّح، والتشبع −100 يجعل الصورة رمادية', () => {
    const a = px(100, 100, 100);
    applyBasic(a, { exposure: 50 });
    expect(a[0]).toBeGreaterThan(180);
    const b = px(200, 50, 50);
    applyBasic(b, { saturation: -100 });
    expect(Math.abs(b[0] - b[1])).toBeLessThan(2);
  });
  it('الحرارة تدفئ', () => {
    const a = px(128, 128, 128);
    applyBasic(a, { temperature: 100 });
    expect(a[0]).toBeGreaterThan(a[2] + 20);
  });
  it('تدوير التدرج اللوني 120° يحول الأحمر إلى أخضر', () => {
    const a = px(255, 0, 0);
    applyHSL(a, { hue: 120 });
    expect(a[1]).toBeGreaterThan(200);
    expect(a[0]).toBeLessThan(30);
  });
  it('توازن اللون في الظلال', () => {
    const a = px(30, 30, 30);
    applyColorBalance(a, { shadows: [0, 0, 60] });
    expect(a[2]).toBeGreaterThan(50);
  });
});

describe('LUT', () => {
  it('يقرأ .cube ويطبق LUT يعكس الألوان', () => {
    let s = 'TITLE "inv"\nLUT_3D_SIZE 2\n';
    for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) s += `${1 - r} ${1 - g} ${1 - b}\n`;
    const lut = parseCube(s);
    expect(lut.size).toBe(2);
    const a = px(255, 0, 64);
    applyLUT3D(a, lut, 1);
    expect(a[0]).toBe(0);
    expect(a[1]).toBe(255);
    expect(Math.abs(a[2] - 191)).toBeLessThan(2);
  });
});
