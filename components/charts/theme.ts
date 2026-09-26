/**
 * The one chart theme (CLAUDE.md §7): data series in the data-* tokens —
 * never gold — thin hairline grids, quiet axes, a dark tooltip. Charts import
 * these instead of restating values, so every chart in the product reads the
 * same and a token change is one edit.
 */
export const CHART = {
  ink: "#F5F3EE",
  line: "rgba(255,255,255,0.08)",
  data1: "#2DD4BF",
  data2: "#818CF8",
  data3: "#F472B6",
  danger: "#EF4444",
} as const;

export const AXIS = {
  stroke: CHART.ink,
  strokeOpacity: 0.2,
  tick: { fill: CHART.ink, fillOpacity: 0.45, fontSize: 11 },
  tickLine: false,
} as const;

export const TOOLTIP = {
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: 10,
  background: "#18181C",
  fontSize: 13,
  color: CHART.ink,
} as const;

export const CURSOR = { fill: "rgba(255,255,255,0.04)" } as const;
