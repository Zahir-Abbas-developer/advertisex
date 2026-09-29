/**
 * The one chart theme (CLAUDE.md §7, "Forest & Mint"). Series run down the
 * green scale; a NEGATIVE value is gray, never red; teal is the single
 * contrasting accent. Charts import these instead of restating values. The
 * hex values are the palette's own and must match app/globals.css
 * (tests/design-tokens.test.ts checks every one).
 */
export const PALETTE = {
  green950: "#022313",
  green800: "#0E5B37",
  green600: "#279D61",
  green400: "#51B883",
  green200: "#9BD4B4",
  green100: "#CEE4D9",
  green50: "#E7F4EB",
  white: "#FFFFFF",
  gray50: "#F8F8FB",
  gray100: "#F1F1F4",
  gray300: "#CBCBCD",
  gray400: "#AFB0B1",
  gray600: "#656565",
  chartFill: "#D5E0DC",
  teal500: "#50A6BC",
} as const;

export const CHART = {
  /** Axis labels, tooltip text — the primary ink. */
  ink: PALETTE.green950,
  /** Gridlines: the hairline. */
  line: "rgba(2,35,19,0.08)",
  /** Primary series / positive. */
  data1: PALETTE.green600,
  /** Secondary series. */
  data2: PALETTE.green400,
  /** Tertiary series. */
  data3: PALETTE.green200,
  /** Deep series / emphasis bar. */
  data4: PALETTE.green800,
  /** Darkest stacked segment. */
  data5: PALETTE.green950,
  /** Negative bars and deltas — gray, never red. */
  negative: PALETTE.gray600,
  neutral: PALETTE.gray300,
  /** One contrasting categorical accent. */
  alt: PALETTE.teal500,
  /** Donut / progress track. */
  track: PALETTE.green100,
  /** Area-chart fill. */
  areaFill: PALETTE.chartFill,
  /** Reference and zero lines. */
  baseline: PALETTE.gray400,
} as const;

/** Stacked bars run dark → light, with teal for one final contrasting segment. */
export const STACK = [CHART.data5, CHART.data4, CHART.data1, CHART.data2, CHART.data3, CHART.alt] as const;

export const AXIS = {
  stroke: CHART.baseline,
  strokeOpacity: 0.6,
  tick: { fill: PALETTE.gray600, fontSize: 11 },
  tickLine: false,
} as const;

export const TOOLTIP = {
  border: "1px solid rgba(2,35,19,0.14)",
  borderRadius: 10,
  background: PALETTE.white,
  fontSize: 13,
  color: CHART.ink,
  boxShadow: "0 10px 30px -18px rgba(2,35,19,0.35)",
} as const;

export const CURSOR = { fill: "rgba(14,91,55,0.05)" } as const;

/**
 * Chart animation, off for people who've asked their system for less motion
 * (WCAG 2.3.3). Recharts animates in JavaScript, so the global CSS rule can't
 * reach it; every series passes `isAnimationActive={chartAnimation()}`.
 */
export const chartAnimation = () => typeof window !== "undefined" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
