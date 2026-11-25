# لوحة — برنامج تركيب الصور الواقعية

تطبيق ويب قابل للتثبيت (PWA) لقصّ العناصر من الصور وتركيبها في لوحة واحدة منسجمة. واجهة عربية من اليمين إلى اليسار، ويعمل بلا إنترنت بعد التحميل الأول.

- المواصفات: [docs/SPEC.md](docs/SPEC.md)
- التقدم: [PROGRESS.md](PROGRESS.md)
- القرارات: [DECISIONS.md](DECISIONS.md)

## التشغيل محليًا

```bash
npm install
npm run dev        # خادم تطوير
npm test           # الاختبارات الآلية
npm run build && npm run test:e2e   # اختبارات المتصفح
```

النشر تلقائي على GitHub Pages عند كل دفع إلى الفرع `main` (ملف `.github/workflows/deploy.yml`).
