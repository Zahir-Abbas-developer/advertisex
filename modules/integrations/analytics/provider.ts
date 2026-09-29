/**
 * The client-data seam (Phase 8 scope 3). A provider turns one client's
 * account into monthly base metrics (modules/client-analytics/metrics.ts);
 * everything downstream — the Results tab, reports — reads MetricValue rows
 * and never knows which provider wrote them.
 */
import type { Channel, ProviderId } from "@/modules/client-analytics/metrics";

export type MonthValues = { metricKey: string; value: number }[];

export interface AnalyticsProvider {
  id: ProviderId;
  label: string;
  channels: readonly Channel[];
  /** Env names a live connection needs (client id, secret, developer token…). */
  requiredEnv: readonly string[];
  /** True when live sync is switched on and credentials are present. */
  live(): boolean;
  /** The OAuth consent URL for connecting a client's account, or null when not configured. */
  connectUrl(input: { redirectUri: string; state: string }): string | null;
  /** One month of base metrics for a client's connected account. */
  fetchMonth(input: { clientId: string; accountId: string | null; month: string }): Promise<MonthValues>;
}

export class IntegrationNotEnabled extends Error {
  constructor(provider: string) {
    super(`${provider} live sync isn't switched on for this deployment`);
  }
}
