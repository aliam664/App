# UHM web fonts

The site self-hosts two variable WOFF2 fonts so it does not rely on Google Fonts at runtime.

| Font | Role | File | Weights |
|---|---|---|---|
| Vazirmatn | Persian UI, instruction copy and Persian headlines | `vazirmatn-arabic-variable.woff2` | 100–900 |
| Outfit | English UI, brand, numbers, labels and English pages | `outfit-latin-variable.woff2` | 100–900 |

## Why this pairing

- **Vazirmatn** is a legible, contemporary Persian/Arabic typeface suited to UI and long instructional text. Its open shapes and generous Persian rhythm make Windows paths and step-by-step copy easier to scan.
- **Outfit** is a compact geometric display/body sans. Its weight range and clear numerals fit UHM's motorsport/technical character without making English copy look like a generic system UI.
- Each is a **variable WOFF2**, so one local file delivers the needed weights instead of many separate requests.

Both font families are distributed under the **SIL Open Font License 1.1**. The corresponding license text is retained in this folder. Sources: [Vazirmatn](https://github.com/rastikerdar/vazirmatn) and [Outfit](https://github.com/Outfitio/Outfit-Fonts), packaged for self-hosting by Fontsource.
