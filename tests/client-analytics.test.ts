import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CHANNEL, CHANNELS, channelMonth, channelsForServices, formatMetric, metricKey, metricText, parseMetric, resolveValues } from "../modules/client-analytics/metrics";
import { mockMonth } from "../modules/integrations/analytics/mock";
import { liveProvider } from "../modules/integrations/analytics/live";
import { acceptSummary, highlightsOf, templateSummary, type ReportData } from "../modules/monthly-reports/domain";

describe("client metric model", () => {
  it("parses into integers by unit and back", () => {
    assert.deepEqual(parseMetric("money", "1,450.5"), { ok: true, value: 145050 });
    assert.deepEqual(parseMetric("decimal", "7.3"), { ok: true, value: 7300 });
    assert.deepEqual(parseMetric("seconds", "1:36"), { ok: true, value: 96 });
    assert.deepEqual(parseMetric("count", "1250"), { ok: true, value: 1250 });
    assert.equal(parseMetric("count", "12.5").ok, false);
    assert.equal(parseMetric("money", "1.234").ok, false);
    assert.equal(metricText("money", 145050), "1450.50");
    assert.equal(formatMetric("seconds", 96), "1:36");
    assert.equal(formatMetric("decimal", 7300), "7.3");
  });

  it("maps services to channels", () => {
    assert.deepEqual(channelsForServices(["google-ads", "local-seo"]), ["googleAds", "leads", "localSeo"]);
    assert.deepEqual(channelsForServices(["branding"]), []);
  });

  it("prefers a person's entry over a sync over demo data", () => {
    const v = resolveValues([
      { metricKey: "googleAds.clicks", source: "MOCK", periodStart: "2026-08-01T00:00:00.000Z", value: 1 },
      { metricKey: "googleAds.clicks", source: "GOOGLE_ADS", periodStart: "2026-08-01T00:00:00.000Z", value: 2 },
      { metricKey: "googleAds.clicks", source: "MANUAL", periodStart: "2026-08-01T00:00:00.000Z", value: 3 },
    ]);
    assert.deepEqual(v.get("2026-08|googleAds.clicks"), { value: 3, source: "MANUAL" });
  });

  it("derives rates from their parts and judges direction per metric", () => {
    const v = new Map<string, { value: number; source: string }>([
      ["2026-08|googleAds.impressions", { value: 10000, source: "MANUAL" }],
      ["2026-08|googleAds.clicks", { value: 500, source: "MANUAL" }],
      ["2026-08|googleAds.cost", { value: 100000, source: "MANUAL" }],
      ["2026-08|googleAds.conversions", { value: 50, source: "MANUAL" }],
      ["2026-08|googleAds.conversionValue", { value: 400000, source: "MANUAL" }],
      ["2026-07|googleAds.cost", { value: 120000, source: "MANUAL" }],
      ["2026-07|googleAds.conversions", { value: 40, source: "MANUAL" }],
    ]);
    const m = channelMonth("googleAds", "2026-08", "2026-07", v);
    const by = (k: string) => m.metrics.find((x) => x.key === k)!;
    assert.equal(by("ctr").value, 5, "500 / 10,000 = 5%");
    assert.equal(by("cpc").value, 200, "$1,000 / 500 clicks = $2.00");
    assert.equal(by("cpa").value, 2000);
    assert.equal(by("roas").value, 4);
    assert.equal(by("cost").good, true, "spending less is better");
    assert.equal(by("conversions").good, true);
    assert.equal(by("cpa").good, true, "$20 per conversion, down from $30");
  });

  it("mocks consistent, deterministic months for every channel", () => {
    for (const c of CHANNELS) {
      const a = mockMonth("client-1", c, "2026-08");
      assert.deepEqual(a, mockMonth("client-1", c, "2026-08"), `${c} is deterministic`);
      assert.equal(a.length, CHANNEL[c].base.length);
      const get = (k: string) => a.find((x) => x.metricKey === metricKey(c, k))?.value ?? 0;
      if (c === "googleAds" || c === "metaAds") {
        assert.ok(get("clicks") <= get("impressions") && get("conversions") <= get("clicks"), `${c} funnel holds`);
      }
    }
  });

  it("builds OAuth consent links only when configured, and keeps live sync off by default", async () => {
    const spec = { id: "GA4" as const, label: "GA4", channels: ["website" as const], env: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"], auth: "google" as const, scopes: ["s"] };
    const off = liveProvider(spec, {} as NodeJS.ProcessEnv);
    assert.equal(off.connectUrl({ redirectUri: "https://x/cb", state: "st" }), null);
    const on = liveProvider(spec, { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s" } as unknown as NodeJS.ProcessEnv);
    assert.match(on.connectUrl({ redirectUri: "https://x/cb", state: "st" })!, /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?client_id=id/);
    assert.equal(on.live(), false, "credentials alone don't switch live sync on");
    await assert.rejects(on.fetchMonth({ clientId: "c", accountId: null, month: "2026-08" }), /isn't switched on/);
  });
});

describe("monthly report text", () => {
  const data: ReportData = {
    version: 1,
    clientName: "Osteria Nonna",
    month: "2026-08",
    monthLabel: "August 2026",
    currency: "USD",
    services: ["Google Ads"],
    channels: [{ channel: "googleAds", label: "Google Ads", question: "q", headline: "Conversions", metrics: [{ key: "conversions", label: "Conversions", unit: "count", derived: false, value: 120, previous: 100, display: "120", change: 20, good: true, source: "MANUAL" }] }],
    projects: [{ title: "Website relaunch", progress: 46, statusText: "In progress", currentStage: "Development", doneThisMonth: ["Design approved"], nextUp: [{ title: "Menu pages", due: "2026-10-03" }] }],
    highlights: [],
    demoData: false,
    generatedAt: "2026-09-01T00:00:00Z",
  };
  data.highlights = highlightsOf(data.channels, data.projects);

  it("states each channel's headline change, and delivery", () => {
    assert.deepEqual(data.highlights, ["Google Ads: 120 conversions, up 20% on last month.", "Website relaunch: 1 milestone completed; now 46% done."]);
    assert.match(templateSummary(data), /^Here is how August 2026 went for Osteria Nonna\./);
  });

  it("accepts an AI summary only if every number in it came from the facts", () => {
    const good = "August 2026 was a strong month for Osteria Nonna. Google Ads brought in 120 conversions, up 20% on last month, and the website relaunch moved forward with the design approved — it is now 46% done. Next, the team will build the menu pages so guests can browse and book more easily.";
    assert.equal(acceptSummary(good, data), good);
    assert.equal(acceptSummary(good.replace("120 conversions", "135 conversions"), data), null, "an invented figure is rejected");
    assert.equal(acceptSummary("- a bullet\n- list", data), null);
    assert.equal(acceptSummary("Too short.", data), null);
  });
});
