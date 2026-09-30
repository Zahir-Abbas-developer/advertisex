import type { Config } from "tailwindcss";

/** A color from a CSS variable holding an RGB channel triple (see app/globals.css). */
const v = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

/**
 * A tint: `percent` of a token mixed into the card surface — solid, so it reads
 * the same on the mint page as on a white card (a translucent red over mint
 * turns brown). Inside a deep panel the surface is green-950, so tints stay dark.
 */
const mix = (name: string, percent: number) => `color-mix(in srgb, rgb(var(${name})) ${percent}%, rgb(var(--surface-1)))`;

/**
 * Advertise X design tokens — "Forest & Mint" (CLAUDE.md §7).
 *
 * The palette is fixed by the founder: every color below maps 1:1 to a value
 * in app/globals.css. No hue is invented; secondary and muted text use the
 * `ink-2` and `ink-muted` tokens, which pass WCAG AA on white.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        /*
         * "Forest & Mint" (CLAUDE.md §7). Every value is a CSS variable from
         * app/globals.css, where the exact hex lives once; a dark panel
         * (.surface-dark) re-scopes the role variables. `<alpha-value>` keeps
         * Tailwind's opacity modifiers (bg-brand/10) working.
         */
        /** Page background — mint. Named `canvas`: `base` would collide with text-base. */
        canvas: v("--bg"),
        /** Cards (white) and elevated/hover panels; `head` is the table header row. */
        surface: { DEFAULT: v("--surface-1"), 2: v("--surface-2"), head: v("--surface-head") },
        /**
         * Text. `ink` is the darkest green (primary); `ink-heading` brand green
         * for card titles; `ink-2` secondary; `ink-muted` gray. Never a green
         * at 600 or lighter for text (tests/design-tokens.test.ts).
         */
        ink: { DEFAULT: v("--ink"), heading: v("--ink-heading"), 2: v("--ink-2"), muted: v("--ink-muted") },
        /** Text on brand, danger and hero fills. */
        "on-brand": v("--on-accent"),
        /** Hairlines — 8% and 14% of the darkest green. No heavy shadows. */
        // `field`: the edge of a form control, which is how you find it — so it
        // meets 3:1 against white and mint (WCAG 1.4.11; Phase 10).
        line: { DEFAULT: "rgb(var(--line) / 0.08)", strong: "rgb(var(--line) / 0.14)", field: "rgb(var(--line) / 0.5)" },
        /** Brand green — identity and emphasis: primary CTA, active nav, the hero KPI. */
        brand: {
          DEFAULT: v("--accent"),
          hover: v("--accent-hover"),
          strong: v("--accent-strong"),
          tint: mix("--accent", 10),
        },
        /**
         * Data. Positive and categorical series run down the green scale; a
         * NEGATIVE value is gray (`data-negative`), never red. Fills only —
         * never text (tests/design-tokens.test.ts).
         */
        data: {
          1: v("--c-green-600"),
          2: v("--c-green-400"),
          3: v("--c-green-200"),
          4: v("--c-green-800"),
          5: v("--c-green-950"),
          negative: v("--c-gray-600"),
          neutral: v("--c-gray-300"),
          alt: v("--c-teal-500"),
          track: v("--c-green-100"),
          area: v("--c-chart-fill"),
          baseline: v("--c-gray-400"),
        },
        /** The raw palette, for the rare direct use (charts, the design-system page). */
        green: {
          950: v("--c-green-950"),
          800: v("--c-green-800"),
          600: v("--c-green-600"),
          400: v("--c-green-400"),
          200: v("--c-green-200"),
          100: v("--c-green-100"),
          50: v("--c-green-50"),
        },
        gray: {
          50: v("--c-gray-50"),
          100: v("--c-gray-100"),
          300: v("--c-gray-300"),
          400: v("--c-gray-400"),
          600: v("--c-gray-600"),
        },
        teal: { 500: v("--c-teal-500") },
        /** Success is green-600 as a fill; as text it is `success-ink` (brand green, 8.2:1). */
        success: { DEFAULT: v("--c-green-600"), ink: v("--c-green-800"), tint: mix("--c-green-600", 12) },
        warn: { DEFAULT: v("--c-warning"), tint: mix("--c-warning", 12) },
        /** Destructive actions and errors only — negative DATA is gray. */
        // `danger` fills and icons; `danger-ink` is its text (WCAG 1.4.3; Phase 10).
        danger: { DEFAULT: v("--c-danger"), tint: mix("--c-danger", 8), ink: v("--c-danger-ink") },
        /** Teal — a fill and icon accent; its text is `ink-2` (teal fails as text). */
        info: { DEFAULT: v("--c-teal-500"), tint: mix("--c-teal-500", 14) },
      },
      fontFamily: {
        display: ["var(--font-display)", "ui-sans-serif", "system-ui", "sans-serif"],
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      letterSpacing: {
        eyebrow: "0.18em",
      },
      borderRadius: {
        card: "14px",
        pill: "999px",
      },
      maxWidth: {
        shell: "1180px",
      },
      spacing: {
        sidebar: "240px",
      },
      backgroundImage: {
        /** The one permitted glow, barely there — deep green panels only */
        "glow-brand":
          "radial-gradient(60% 80% at 15% 0%, rgb(var(--c-green-600) / 0.22) 0%, rgb(var(--c-green-800) / 0.08) 45%, rgb(var(--c-green-950) / 0) 75%)",
        "glow-brand-soft":
          "radial-gradient(70% 120% at 85% 110%, rgb(var(--c-green-600) / 0.10) 0%, rgb(var(--c-green-950) / 0) 65%)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "translateY(6px) scale(0.985)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        /* Transform-only: if the animation never runs, the element is still
           in its final position rather than invisible. */
        "slide-in-right": {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
      },
      animation: {
        // `forwards` matters: without a fill mode these animations leave the
        // element at its pre-animation opacity if the animation is suppressed
        // or interrupted, which silently renders panels invisible.
        "fade-in": "fade-in 160ms ease-out forwards",
        "scale-in": "scale-in 180ms cubic-bezier(0.22, 1, 0.36, 1) forwards",
        "slide-in-right": "slide-in-right 220ms cubic-bezier(0.22, 1, 0.36, 1)",
        shimmer: "shimmer 1.6s infinite",
      },
    },
  },
  plugins: [],
};

export default config;
