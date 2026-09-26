# Ağıllı Nağıllar

Studiya saytı — statik HTML/CSS/JS, build addımı yoxdur.

## Lokal işə salmaq

```sh
python3 -m http.server 8000
# http://localhost:8000
```

(3D səhnə SVG-ni `fetch` ilə oxuduğu üçün faylı birbaşa `file://` ilə yox, server ilə açın.)

## Struktur

- `index.html` — bütün bölmələr: hero (canlı 3D), studiya, işlər, personajlar, xidmətlər, jurnal, əlaqə
- `assets/css/style.css` — rəng tokenləri (`--lime`, `--ink`, `--lav`, `--pink`, `--sky`) və bütün stillər
- `assets/js/main.js` — loader, header, kursor, scroll effektləri, akkordeon, jurnal önizləmə
- `assets/js/scene.js` — Three.js hero səhnəsi (laym "gil" borular, xrom/perforasiyalı kapsullar, 3D spiral)
- `assets/brand/` — loqo, işarə və wordmark SVG-ləri (`.ai` master fayllarından çıxarılıb)
- `assets/characters/` — 10 personaj SVG
- `assets/fonts/AghilliNaghillar.otf` — brend şrifti
- `assets/vendor/` — Three.js r169 (MIT), lokal saxlanılır
