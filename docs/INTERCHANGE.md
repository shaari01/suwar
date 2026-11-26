# صيغة حزمة الطبقات (lawha-layers)

يصدّرها «لوحة» من القائمة ← «إرسال إلى برنامج الصور المتحركة»، أو من «تصدير ← حزمة طبقات».
الغرض: أن يفتحها برنامج الصور المتحركة (haraka) فيحرّك كل طبقة وحدها.

ملف ZIP (بلا ضغط) فيه:

```
manifest.json
preview.png          الصورة النهائية كاملة (بما فيها طبقات التعديل)
layers/001.png       أسفل طبقة
layers/002.png
...
```

## manifest.json

```json
{
  "format": "lawha-layers",
  "version": 1,
  "app": "لوحة",
  "name": "اسم اللوحة",
  "width": 1920,
  "height": 1080,
  "background": "#ffffff",
  "layers": [
    {
      "id": "l_abc",
      "name": "السماء",
      "type": "image",
      "group": null,
      "file": "layers/001.png",
      "x": 0, "y": 0,
      "width": 1920, "height": 1080,
      "opacity": 1,
      "blend": "normal",
      "visible": true
    }
  ]
}
```

- الطبقات مرتبة **من الأسفل إلى الأعلى**.
- كل PNG شفاف، مقصوص إلى حدود محتواه، وكل التحويلات (التحجيم والتدوير والقناع والتشويه والتأثيرات) مطبقة عليه مسبقًا.
- `x` و`y` موضع الزاوية العليا اليسرى للصورة في إحداثيات اللوحة (بالبكسل).
- `type`: ‏`image` أو `shadow` (الظل طبقة مستقلة يمكن تحريكها مع عنصرها).
- `group`: اسم المجموعة (مع `/` للمجموعات المتداخلة) أو `null`.
- `blend`: أسماء أنماط الدمج في Canvas: `normal`، `multiply`، `screen`، `overlay`، `soft-light`، `hard-light`، `color-dodge`، `color-burn`، `darken`، `lighten`، `difference`، `exclusion`، `hue`، `saturation`، `color`، `luminosity`.
- `background`: لون الخلفية أو `null` للشفاف.
- طبقات التعديل لا تُصدَّر منفصلة؛ أثرها في `preview.png` فقط.
