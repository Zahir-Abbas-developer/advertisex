# Design System — Obsidian & Gold

> How CLAUDE.md §7 is implemented in this codebase. §7 is the doctrine; this
> document is the map from doctrine to code. If they disagree, §7 wins and this
> file has a bug. Established Phase 1 (2026-09-25); founder decision D3.

## Where the system lives

| Layer | File | What it holds |
|---|---|---|
| Tokens | `tailwind.config.ts` | Colors, fonts, radii, glow gradients — the only place a color value is defined |
| Base styles | `app/globals.css` | Page background, selection, focus ring, `.surface-dark`, scrollbars |
| Fonts | `app/layout.tsx` | Inter Tight (display) + Inter (body) via `next/font`, exposed as `--font-display` / `--font-sans` |
| Primitives | `components/ui/*` | Button, Card, Badge, Input, Modal, Table, Tabs, Toast, EmptyState, Skeleton… |
| Charts | `components/kpis/KpiCharts.tsx` | The recharts theme constants (data-series hexes live here, mirrored from the tokens) |
| Emails | `lib/email/templates.ts` | Inline-styled palette — deliberately light-canvas (see below) |
| Icons | `scripts/generate-icons.mjs` | PWA/touch icons: gold "A" on obsidian |

## Tokens

Class-name → value → §7 variable. The class names predate the retheme — they are
kept so seven hundred call sites didn't churn — but every **value** is §7's.

| Tailwind token | Value | §7 name | Use |
|---|---|---|---|
| `base` | `#0B0B0D` | `--bg` | Page background (`bg-base`); also text on gold (`bg-brand text-base`) |
| `surface` | `#121215` | `--surface-1` | Cards |
| `surface-2` | `#18181C` | `--surface-2` | Elevated: hovers, popovers, inset panels |
| `ink` | `#F5F3EE` | `--text` | All foreground text. Secondary/muted text is opacity, not a second token: `text-ink/60`, `text-ink/45` |
| `line` / `line-strong` | white 8% / 14% | `--border(-strong)` | Hairlines. Depth = surface steps + hairlines, never shadows |
| `brand` / `brand-hover` / `brand-tint` | `#D4AF37` / `#E5C558` / gold 12% | `--accent*` | Identity & emphasis **only**: primary CTA, active nav/chips, headline KPIs. Swappable in one place |
| `data-1/2/3` | `#2DD4BF` / `#818CF8` / `#F472B6` | `--data-*` | Chart series. **Charts never use gold.** |
| `success/warn/danger/info` (+`-tint`) | `#22C55E` / `#F59E0B` / `#EF4444` / `#38BDF8` | semantic | Status only. Badge `success` is green, not gold |

Recurring compositions:

- **Active/selected chip:** `border-brand/50 bg-brand-tint text-brand` (was the
  old solid-ink chip — gold-soft is the selected state everywhere now).
- **Gold CTA:** `bg-brand text-base hover:bg-brand-hover` — dark text on gold,
  never white on gold.
- **Overlay scrims** (Modal, Drawer, command palette): `bg-black/60` — true
  black, not a token, because the scrim must darken regardless of theme.
- **Hero panels:** the `.surface-dark` utility — `#08080A` (one step *below*
  the page) with the `bg-glow-brand` radial gold glow as a `::before`. Used by
  `<Card surface="dark">` and `PageHeader`. This is the one permitted glow.
- **Hairlines on heroes:** `border-ink/10`, `ring-ink/15` — ink-alpha, since
  ink is the warm white.

## Typography

- **Display** (`font-display`): Inter Tight 500/600/700 — headings, KPI
  numbers, the wordmark. Weight caps at **700**: `font-extrabold` is banned
  (the face isn't loaded above 700; the class silently falls back).
- **Body** (`font-sans`, default): Inter 400/500/600.
- Numbers use tabular figures (`tabular-nums`) wherever they align in columns.
- Scale and line-heights follow §7 (12/14/16/20/24/32/40; 1.5 body, 1.15 display).

## Charts

recharts, themed in `KpiCharts.tsx`: series draw with `data-1`/`data-2`
(teal/indigo; rose is rare), grid lines white-8%, axis text ink at low opacity,
tooltips on `surface-2` with a strong hairline. Semantic exceptions are allowed
where the color *is* the meaning (ROAS below target = danger). Area fills ≤ 8%
opacity, 1.5–2px strokes, 1–3 series, no gradients beyond the permitted fills.
The MRR hero sparkline is `data-1` teal — a chart, so not gold, even on the
gold-glow panel.

## The deliberate exceptions

- **Emails** (`lib/email/templates.ts`) keep a light canvas: dark-themed HTML
  is what email clients mangle most. They carry the brand as an obsidian
  header, an obsidian CTA with gold text, and a **deep gold** (`#8C6D1F`) for
  accent text — `#D4AF37` fails contrast on white.
- **`app/global-error.tsx`** uses inline styles (it renders before any CSS
  pipeline exists) — obsidian page, gold CTA, values hard-coded on purpose.
- **Report documents** (`components/reports/*Document.tsx`) currently render
  on app tokens (dark). If a print/PDF path is added later, they will need a
  light token set — noted, not built (over-engineering ahead of need).

## Rules that keep it premium

Straight from §7, enforced in review:

1. Gold is scarce. If a screen has more than one solid-gold element visible at
   rest, something is misusing the token.
2. No shadows for depth; surface steps + hairlines only. One glow, on heroes.
3. Motion 150–200ms ease-out, state changes only.
4. No emojis in UI, no decorative gradients, no oversized icons (Lucide
   16–20px, 1.5 stroke).
5. New colors enter through `tailwind.config.ts` or not at all. A literal hex
   in a component is a review failure (charts/email/global-error excepted, as
   above).
