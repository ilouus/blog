# Qardaş, burax da!

Bakı tıxacından ilhamlanan mobil veb oyun. 3 zolaqlı yolda sol zolaqdan başlayırsan və
90 saniyə ərzində 300 metr irəlidəki sağ dönüşə çatmalısan. Bunun üçün qonşu sürücülərdən
yol istəyib, maşınların arasından keçməlisən.

## İşə salmaq

```bash
npm install
npm run dev      # inkişaf serveri (http://localhost:5173)
npm run build    # tip yoxlaması + production build (dist/)
npm run preview  # build-i yerli serverdə açmaq
npm test         # başsız simulyasiya testləri
```

`dist/` qovluğu istənilən statik hostinqə yüklənə bilər (`base: './'`).

## İdarəetmə

| Hərəkət | Mobil | Klaviatura |
| --- | --- | --- |
| İstiqamət seçmək (dönmə işığı) | ◀ / ▶ | ← / → |
| Siqnal | Siqnal | H |
| Yol istəmək | Əl elə | E |
| Zolaq dəyişmək | Keç | Space |
| Təşəkkür (avariya işıqları) | Sağ ol | T |
| Pauza | ❚❚ | Esc / P |

Maşın özü asta irəliləyir və qabaqdakı maşına çatanda dayanır. İstiqamət seçiləndə hədəf
zolaqda kölgə görünür: **yaşıl** — keçmək olar, **qırmızı** — sığmır.

## Sürücülər

Hər sürücünün üzü onun xasiyyətini göstərir:

- **Nəzakətli** (gülümsəyir): əl edəndə əyləc basır, fənərləri yandırıb-söndürür, əli ilə "buyur" edir.
- **İnadkar** (qaşqabaqlı): dönmə işığını görəndə boşluğu bağlayır, qızarıb "buxar" buraxır. Bir neçə saniyədən sonra yola gəlir.
- **Fikri yayınmış** (telefona baxır): əl eləməyə reaksiya vermir, tıxac açılanda gec tərpənir. Qısa siqnaldan sonra başını qaldırır və yol verə bilir.

Siqnalı tez-tez basmaq **əsəb** göstəricisini qaldırır — o zaman sürücülər gec və az yol verir.
Əsəb vaxt keçdikcə azalır. Keçdikdən sonra 2 saniyə ərzində "Sağ ol" basmaq əlavə xal verir.

## Struktur

- `src/world.ts` — DOM-dan asılı olmayan simulyasiya: trafik dalğaları, maşın ardıcıllığı, NPC state machine, boşluq yoxlaması, xal.
- `src/render.ts` — Canvas 2D ilə yol, binalar, maşınlar, danışıq buludları.
- `src/game.ts` — sabit addımlı `requestAnimationFrame` dövrü, ekranlar, HUD, idarəetmə, təlimat, paylaşma.
- `src/audio.ts` — Web Audio ilə sintez olunmuş səslər.
- `src/bot.ts` — başlanğıc ekranındakı canlı fon və testlər üçün avtopilot.
- `tests/sim.test.ts` — yüzlərlə təsadüfi raundu oynayır: maşınlar üst-üstə düşmür, teleport olmur, oyun qazanıla biləndir, heç nə etməyən oyunçu isə dönüşü keçir.
