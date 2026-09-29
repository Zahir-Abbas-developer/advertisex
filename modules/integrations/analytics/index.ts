import { LIVE_PROVIDERS } from "@/modules/integrations/analytics/live";
import type { AnalyticsProvider } from "@/modules/integrations/analytics/provider";
import type { ProviderId } from "@/modules/client-analytics/metrics";

export { mockMonth } from "@/modules/integrations/analytics/mock";
export { IntegrationNotEnabled } from "@/modules/integrations/analytics/provider";

/** The registry: one adapter per provider. Adding a provider is adding it here. */
export const ANALYTICS_PROVIDERS: readonly AnalyticsProvider[] = LIVE_PROVIDERS;
export const analyticsProvider = (id: ProviderId) => ANALYTICS_PROVIDERS.find((p) => p.id === id) ?? null;

/**
 * Demo sync: development and demos only. Never on in production, whatever
 * the flag says — demo numbers must not reach a real client's report.
 */
export const mockSyncEnabled = (env: NodeJS.ProcessEnv = process.env) => env.ANALYTICS_MOCK === "true" && env.NODE_ENV !== "production";
