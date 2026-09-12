# UHM Pack Installer — Design System

Direction: **"pit lane at night."** Warm charcoal, one racing-red accent, a
yellow flag for warnings, squared display type, mono numerals. Calm by
default; motion only at the moments that matter.

All tokens live in `src/css/base.css`. Component skins live in
`src/css/theme.css` (loaded last, overrides `pages.css` / `library.css` /
`donate.css`). Change tokens, not components.

## 1. Color

| Token | Night | Day | Use |
|---|---|---|---|
| `--color-bg` | `#121417` | `#f1ede6` | app background (warm, never blue) |
| `--color-surface` | `#1c1f25` | `#ffffff` | cards, rows |
| `--color-surface-2` | `#23272e` | `#f5f2ec` | inputs, chips, hover state |
| `--color-surface-3` | `#2b3038` | `#e9e4dc` | tracks, segmented controls |
| `--color-hairline` | white 8% | black 8% | dividers, grid gaps |
| `--color-text` | `#f2efe9` | `#17191d` | body |
| `--color-text-dim` | `#9aa0a8` | `#5d626b` | secondary |
| `--color-text-faint` | `#6b717a` | `#8b9099` | labels, timestamps |
| `--color-accent` | `#ff4d2e` | same | **one** accent: primary buttons, selection rail, kicker text |
| `--color-flag` | `#ffd166` | `#8a5a00` text on day | warnings ("yellow flag") |
| `--color-success` | `#37d67a` | `#1f9d57` | done / valid |
| `--color-error` | `#ff3b3b` | `#d12b2b` | failures |

Rules
- Exactly one hue for emphasis. `--color-accent-2` (old blue) exists only
  for backward compatibility — do not use it in new CSS.
- State is shown by a **2px inline-start rail** or a tinted `*-soft` fill,
  never by a 1px gray border around the whole card.
- Surfaces separate by tone (`surface` → `surface-2` → `surface-3`), not by
  borders. Lists use `gap: 1px; background: var(--color-hairline)`.
- Body text contrast target: APCA Lc ≥ 75; dim text ≥ 60.

## 2. Type

| Token | Font | Use |
|---|---|---|
| `--font` | Vazirmatn | body (Persian + Latin) |
| `--font-display` | Estedad 700–900 | Persian headings, card titles |
| `--font-display-latin` | Chakra Petch 500–700 | brand, big numbers, tier names in Latin |
| `--font-mono` | JetBrains Mono 400/600 | paths, percentages, kickers, badges |

- Kickers: mono, 10.5px, `letter-spacing: .12em`, uppercase, accent color.
- Percentages / counts: `font-variant-numeric: tabular-nums`.
- No gradient text. No text-shadow glows.

## 3. Shape

| Token | Value | Use |
|---|---|---|
| `--radius-card` | 12px | cards |
| `--radius-sm` | 8px | inputs, rows |
| `--radius-xs` | 6px | buttons |
| chips / badges | 4px | squared, "label maker" feel |

Radii are deliberately smaller than the default "SaaS" 16–24px.

## 4. Motion

| Token | Value | Use |
|---|---|---|
| `--dur-fast` | 120ms | hover, focus, toggles |
| `--dur-base` | 200ms | card lift, chip state |
| `--dur-slow` | 320ms | progress width, list rows appearing |
| `--dur-page` | 420ms | page enter |
| `--ease-out` | `cubic-bezier(.16,1,.3,1)` | everything entering |
| `--ease-in` | `cubic-bezier(.7,0,.84,0)` | everything leaving |
| `--ease-spring` | `cubic-bezier(.34,1.56,.64,1)` | the one success pop |
| `--stagger` | 45ms | first grid on a page only |

The five moments that animate
1. **Page enter** — `.page-enter` (slide 12px + fade), first grid staggers.
   Settings and game-path pages are still (forms should not move).
2. **Tier selection** — selected card gets the red rail; its start lights
   pulse (`uhmLight`); one `uhmPulseRing` on click.
3. **Install progress** — diagonal stripes travel on the bar (`uhmStripes`),
   the percentage is a large Chakra Petch number, log lines rise in. Bar
   turns solid green (`.is-done`) at 100%.
4. **Success** — checkmark pops once with `--ease-spring`.
5. **Toast** — bottom-center pill, rises 8px, leaves with `--ease-in`.

Everything else is a 120–200ms hover/focus transition. Hover always moves
`transform` + `box-shadow` together. `prefers-reduced-motion` disables all of
the above (handled in `base.css` and in `app.js#choreographPage`).

## 5. Anti-patterns (do not reintroduce)

- purple→blue or cyan-on-dark gradients; gradient text; neon glow borders
- 1px gray border on every card; 3–4px colored side strip on toasts
- cards inside cards; glassmorphism blur on content surfaces
- uniform 16–24px radii on everything
- Inter / Roboto / system-ui as display type
- floating emoji / hearts / sparkles; infinite sheen sweeps on content
- animating forms and settings on entry
- centered "hero + pill badge + three feature cards" layout on utility pages
