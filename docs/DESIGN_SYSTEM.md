# Design System — Forest & Mint

> How CLAUDE.md §7 is implemented in this codebase. §7 is the doctrine; this
> document is the map from doctrine to code. If they disagree, §7 wins and this
> file has a bug. Established Phase 1 as "Obsidian & Gold" (D3); rethemed to
> the light "Forest & Mint" palette by the founder on 2026-09-28 (ADR-017).
> The palette comes from `forest-mint-theme.css`, sampled pixel-exact from the
> founder's reference dashboard. Its values are fixed: never adjust a hex.

## Where the system lives

| Layer | File | What it holds |
|---|---|---|
| Values | `app/globals.css` | **The only place a color value is defined**: the raw palette as RGB triples (`--c-green-800: 14 91 55`), the role variables that point at it, and the `.surface-dark` re-scope |
| Tokens | `tailwind.config.ts` | Maps class names to the role variables (`rgb(var(--ink) / <alpha-value>)`), plus fonts, radii and the glow |
| Fonts | `app/layout.tsx` | Inter Tight (display) + Inter (body) via `next/font` |
| Primitives | `components/ui/*` | Button, Card, Badge, Input, Select, Textarea, Checkbox, Modal, Drawer, Dropdown, Tooltip, Table, Tabs, Toast, StatCard, Pagination, EmptyState, Skeleton, Avatar… |
| Charts | `components/charts/theme.ts` | `PALETTE` (the hexes, for recharts and SVG), `CHART` roles, `STACK` order, `AXIS`, `TOOLTIP`, `CURSOR` |
| Showcase | `/design-system` (dev-only) | The palette ramp, role tokens, data rules and every primitive, rendered live |
| Guards | `tests/design-tokens.test.ts` | The palette is exact; the two text/data rules; no off-palette color |
| Emails · PDF · icons | `lib/email/templates.ts` · `modules/billing/pdf.ts` · `scripts/generate-icons.mjs` | Inline copies of the same hexes (they can't read CSS variables) |

## The palette (exact)

| Raw | Hex | Role |
|---|---|---|
| green-950 | `#022313` | primary ink; darkest stacked segment; deep panels |
| green-800 | `#0E5B37` | **brand**: CTA, active nav, the hero KPI card, card titles |
| green-600 | `#279D61` | series 1 / positive · success fill |
| green-400 | `#51B883` | series 2 |
| green-200 | `#9BD4B4` | series 3 |
| green-100 | `#CEE4D9` | donut/progress track, light fills |
| green-50 | `#E7F4EB` | page background |
| white | `#FFFFFF` | cards |
| gray-50 | `#F8F8FB` | surface-2: hover, elevated, inset |
| gray-100 | `#F1F1F4` | table header row |
| gray-300 | `#CBCBCD` | neutral data |
| gray-400 | `#AFB0B1` | baselines, reference lines |
| gray-600 | `#656565` | **negative data**; muted text |
| chart-fill | `#D5E0DC` | area fill |
| teal-500 | `#50A6BC` | the one contrasting accent (final stacked segment, info fills) |

Derived in the theme file (not in the screenshot): `#3D5E4C` secondary text,
`#166A41` brand hover, `#D97706` warning, `#DC2626` danger.

## Tokens (class → role)

| Tailwind | Role | Notes |
|---|---|---|
| `canvas` | `--bg` green-50 | page. Not `base`: Tailwind owns `text-base` |
| `surface` / `surface-2` / `surface-head` | white / gray-50 / gray-100 | depth = mint → gray-50 → white + hairlines |
| `ink` | green-950 | primary text, 16.8:1 |
| `ink-heading` | green-800 | card titles (`CardHeader`), 8.2:1 |
| `ink-2` | `#3D5E4C` | secondary text |
| `ink-muted` | gray-600 | muted text, 5.8:1. Replaced the old `text-ink/40…60` opacities, which fail on white |
| `on-brand` | white | text on brand, danger and hero fills |
| `line` / `line-strong` | green-950 at 8% / 14% | hairlines |
| `brand` (`-hover`, `-strong`, `-tint`) | green-800 · `#166A41` · green-950 · 10% | identity and emphasis |
| `data-1…5`, `data-negative`, `data-neutral`, `data-alt`, `data-track`, `data-area`, `data-baseline` | the green scale · gray-600 · gray-300 · teal · green-100 · chart-fill · gray-400 | fills only |
| `success` / `success-ink` / `success-tint` | green-600 / green-800 / 12% | fill green-600; **text** is `success-ink` |
| `warn`, `danger`, `info` (+`-tint`) | `#D97706`, `#DC2626`, teal | see rules |
| `danger-ink` | `#B91C1C` | red **text** (errors, alert statuses): ≥5.4:1 on white, mint and the danger tint; `#DC2626` stays for fills, borders and icons (Phase 10) |
| `line-field` | ink at 50% | the edge of a form control — 3.3:1 on white and mint (WCAG 1.4.11; Phase 10) |
| `green-*`, `gray-*`, `teal-500` | the raw palette | only the listed steps exist in use (tested) |

## The rules (enforced by `tests/design-tokens.test.ts`)

1. **Negative data is gray, never red.** Falling trends, negative deltas,
   bars below zero and low scores use `data-negative` (gray-600). `danger` is
   for destructive actions and errors. Alert **statuses** (an "Overdue" or
   "Absent" badge, a late date, an "at risk" dot) keep danger red: they are
   states that need action, not numbers. A number itself is never red.
2. **Green-600 and lighter are never text**, and neither is teal. The test
   fails any `text-green-600…50`, `text-teal-500`, `text-data-*` (except
   `data-negative`), `text-success`, `text-info` or `text-warn` in a class
   string. Icons are exempt: a literal that sizes an icon (`h-4 w-4 …`), plus
   the two icon-chip maps (StatCard, NotificationBell). Text uses `ink`,
   `ink-2`, `ink-muted`, `ink-heading`, `brand`, `success-ink` or
   `danger-ink`. The warning orange is 3.2:1 on white, so warning text is ink;
   the orange stays on tints, borders and icons. Faint ink (`ink/20`–`/35`)
   is not text either — `ink-muted` is the lightest readable step.
3. **One filled hero card per view:** `<StatCard variant="hero">` (brand fill,
   white text) on Finance, Leads analytics and Projects analytics.
4. **Stacked bars run dark → light** (`STACK`: 950, 800, 600, 400, 200), with
   teal for one contrasting final segment.
5. **Card titles are brand green** (`ink-heading`); body numbers are `ink`.
6. **Depth:** mint page → gray-50 → white cards, hairlines, no heavy shadows.
   Scrims are green-950 at 40%.
7. **New colors enter through `app/globals.css` or not at all.** No stock
   Tailwind palette, no off-palette steps, no Obsidian & Gold hex (tested).

## Deep panels (`.surface-dark`)

The sidebar, dashboard hero, attendance and performance hero cards, the
login panel and report mastheads use `.surface-dark`: a green-950 panel under
a faint green glow. It **re-scopes the role variables**: `ink` becomes white,
`ink-2`/`ink-muted` become gray-100/gray-300, hairlines become white-alpha,
`surface-2` becomes green-800, and the **accent turns white** (a white button
with green-950 text, white active states). So nothing inside needs different
classes, and no light green is ever used as text.

## Charts

`components/charts/theme.ts` is the only chart palette. Series follow the
green scale (`data1` green-600 first). Negatives are gray, and a target line
is a dashed gray baseline. Tooltips are white with a hairline. Axis text is
gray-600, and gridlines are the hairline.

## Typography

Unchanged: Inter Tight (display, ≤700) and Inter (body), tabular figures for
aligned numbers, scale 12/14/16/20/24/32/40.

## Outside the CSS pipeline

- **Emails**: mint page, white card, green-950 header band with white title
  and gray-300 eyebrow, brand-green CTA with white text, gray-600 muted text.
- **`app/global-error.tsx`** and **`public/offline.html`**: inline styles, mint
  page, brand CTA.
- **Invoice PDF**: green-950 header band with a green-600 rule, a brand mark,
  white title, a mint amount panel and brand table rule.
- **PWA icons and manifest**: white "A" on brand green; theme color brand,
  background mint.


## Accessibility (Phase 10)

- **Focus:** a 2px brand ring at full strength (8:1) on every focusable
  element; dialogs (Modal, Drawer, the command palette, the mobile nav) trap
  focus and return it on close; every shell starts with a *Skip to content*
  link.
- **Motion:** `prefers-reduced-motion` stops CSS animation and transitions,
  and every chart series passes `isAnimationActive={chartAnimation()}`.
- **Semantics:** Tabs use a roving tabindex with arrow keys; charts carry
  `role="img"` and their question as the label; card and empty-state titles
  are h2 under the page's h1 (h3 inside a titled card).
- **Measured:** Lighthouse accessibility 100 on every core screen of all
  three experiences (staging, 2026-09-29).
