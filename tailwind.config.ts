import type { Config } from "tailwindcss";

/**
 * BWM design tokens.
 *
 * The palette is fixed by CLAUDE.md — every colour below maps 1:1 to a token
 * documented there. No extra hues are invented: secondary text uses opacity
 * modifiers on `ink` (e.g. `text-ink/60`) rather than new greys.
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
        /**
         * Obsidian page background — the ground everything sits on. Named
         * `canvas`, not `base`: Tailwind already owns `text-base` (a font size),
         * and a color token called `base` silently loses to it.
         */
        canvas: "#0B0B0D",
        /** Cards */
        surface: { DEFAULT: "#121215", 2: "#18181C" },
        /** Warm white — all foreground text; secondary text via opacity (text-ink/60) */
        ink: "#F5F3EE",
        /** Hairline borders — depth comes from surface steps + hairlines, not shadows */
        line: { DEFAULT: "rgba(255,255,255,0.08)", strong: "rgba(255,255,255,0.14)" },
        /** Champagne gold — the signature. Identity and emphasis only; never a chart series. */
        brand: {
          DEFAULT: "#D4AF37",
          hover: "#E5C558",
          tint: "rgba(212,175,55,0.12)",
        },
        /** Chart series — charts never use gold */
        data: { 1: "#2DD4BF", 2: "#818CF8", 3: "#F472B6" },
        success: { DEFAULT: "#22C55E", tint: "rgba(34,197,94,0.14)" },
        warn: { DEFAULT: "#F59E0B", tint: "rgba(245,158,11,0.14)" },
        danger: { DEFAULT: "#EF4444", tint: "rgba(239,68,68,0.14)" },
        info: { DEFAULT: "#38BDF8", tint: "rgba(56,189,248,0.14)" },
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
        /** The one permitted glow, barely there — dark hero panels only */
        "glow-brand":
          "radial-gradient(60% 80% at 15% 0%, rgba(212,175,55,0.10) 0%, rgba(212,175,55,0.03) 42%, rgba(11,11,13,0) 72%)",
        "glow-brand-soft":
          "radial-gradient(70% 120% at 85% 110%, rgba(212,175,55,0.06) 0%, rgba(11,11,13,0) 65%)",
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
