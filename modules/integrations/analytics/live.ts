import { IntegrationNotEnabled, type AnalyticsProvider } from "@/modules/integrations/analytics/provider";
import type { Channel, ProviderId } from "@/modules/client-analytics/metrics";

/**
 * The five live adapters. Each declares what it needs and builds its OAuth
 * consent URL; the API calls themselves are the next step, behind
 * INTEGRATIONS_LIVE=true (docs/DECISIONS.md, ADR-018). Until then sync
 * refuses with IntegrationNotEnabled and results come from manual entry.
 */

type Spec = { id: ProviderId; label: string; channels: Channel[]; env: string[]; auth: "google" | "meta"; scopes: string[] };

const SPECS: Spec[] = [
  { id: "GOOGLE_ADS", label: "Google Ads", channels: ["googleAds"], env: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_ADS_DEVELOPER_TOKEN"], auth: "google", scopes: ["https://www.googleapis.com/auth/adwords"] },
  { id: "META_ADS", label: "Meta Ads", channels: ["metaAds"], env: ["META_APP_ID", "META_APP_SECRET"], auth: "meta", scopes: ["ads_read", "read_insights"] },
  { id: "GA4", label: "Google Analytics 4", channels: ["website", "leads"], env: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"], auth: "google", scopes: ["https://www.googleapis.com/auth/analytics.readonly"] },
  { id: "SEARCH_CONSOLE", label: "Search Console", channels: ["seo"], env: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"], auth: "google", scopes: ["https://www.googleapis.com/auth/webmasters.readonly"] },
  { id: "GOOGLE_BUSINESS_PROFILE", label: "Google Business Profile", channels: ["localSeo"], env: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"], auth: "google", scopes: ["https://www.googleapis.com/auth/business.manage"] },
];

export function liveProvider(spec: Spec, env: NodeJS.ProcessEnv = process.env): AnalyticsProvider {
  const configured = () => spec.env.every((k) => Boolean(env[k]));
  return {
    id: spec.id,
    label: spec.label,
    channels: spec.channels,
    requiredEnv: spec.env,
    live: () => env.INTEGRATIONS_LIVE === "true" && configured(),
    connectUrl({ redirectUri, state }) {
      if (!configured()) return null;
      if (spec.auth === "google") {
        const q = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID!, redirect_uri: redirectUri, response_type: "code", access_type: "offline", prompt: "consent", scope: spec.scopes.join(" "), state });
        return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
      }
      const q = new URLSearchParams({ client_id: env.META_APP_ID!, redirect_uri: redirectUri, response_type: "code", scope: spec.scopes.join(","), state });
      return `https://www.facebook.com/v21.0/dialog/oauth?${q}`;
    },
    async fetchMonth() {
      throw new IntegrationNotEnabled(spec.label);
    },
  };
}

export const LIVE_PROVIDERS: readonly AnalyticsProvider[] = SPECS.map((s) => liveProvider(s));
export const specFor = (id: ProviderId) => SPECS.find((s) => s.id === id)!;
