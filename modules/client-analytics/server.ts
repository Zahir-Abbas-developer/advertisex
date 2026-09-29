import "server-only";

import { prisma, transaction } from "@/lib/prisma";
import { companyTimezone } from "@/lib/company-time";
import { authorize, type Principal } from "@/modules/rbac/authorize";
import { dayKey } from "@/modules/billing/domain";
import {
  CHANNEL,
  CHANNELS,
  channelMonth,
  channelsForServices,
  metricKey,
  metricText,
  parseMetric,
  previousMonth,
  PROVIDER_LABEL,
  PROVIDERS,
  resolveValues,
  type Channel,
  type ProviderId,
} from "@/modules/client-analytics/metrics";
import { analyticsProvider, IntegrationNotEnabled, mockMonth, mockSyncEnabled } from "@/modules/integrations/analytics";

/**
 * Client results (Phase 8 scope 3), server side: who may see and enter
 * them, the month view, manual entry, and sync through the adapters.
 */

export class ResultsError extends Error {
  constructor(
    message: string,
    public status: number,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

const monthStart = (month: string) => new Date(`${month}-01T00:00:00.000Z`);
const isMonth = (m: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

export async function clientForResults(principal: Principal, clientId: string, action: "read" | "create") {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, businessName: true, organizationId: true, departmentId: true, clientAccountId: true } });
  if (!client) return null;
  const ok = authorize(principal, action, "clientMetric", { organizationId: client.organizationId ?? undefined, departmentId: client.departmentId, clientId: client.id }).allowed;
  return ok && principal.role !== "CLIENT" ? client : null;
}

/** The last `count` months ending with `month`, oldest first. */
function monthsEnding(month: string, count: number): string[] {
  const out = [month];
  while (out.length < count) out.unshift(previousMonth(out[0]));
  return out;
}

export async function currentMonth(now = new Date()): Promise<string> {
  return dayKey(now, await companyTimezone()).slice(0, 7);
}

/** One month of a client's results, every relevant channel, with a six-month trend of each channel's headline metric. */
export async function resultsFor(clientId: string, month: string) {
  const months = monthsEnding(month, 6);
  const [client, rows, connections] = await Promise.all([
    prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { organization: { select: { currency: true } }, services: { where: { status: { not: "ENDED" } }, select: { service: { select: { slug: true } } } } } }),
    prisma.metricValue.findMany({ where: { clientId, granularity: "MONTH", periodStart: { gte: monthStart(previousMonth(months[0])), lte: monthStart(month) } }, select: { metricKey: true, source: true, periodStart: true, value: true } }),
    prisma.integrationConnection.findMany({ where: { clientId } }),
  ]);
  const currency = client.organization?.currency ?? "USD";
  const values = resolveValues(rows.map((r) => ({ ...r, periodStart: r.periodStart.toISOString() })));
  const fromServices = channelsForServices(client.services.map((s) => s.service.slug));
  const withData = new Set(rows.map((r) => r.metricKey.split(".")[0]));
  const channels = CHANNELS.filter((c) => fromServices.includes(c) || withData.has(c));
  const sources = new Set<string>();
  for (const [key, v] of values) if (key.startsWith(month)) sources.add(v.source);
  return {
    month,
    months,
    currency,
    demoData: sources.has("MOCK"),
    channels: channels.map((c) => {
      const view = channelMonth(c, month, previousMonth(month), values, currency);
      const headline = CHANNEL[c].base.find((b) => b.headline) ?? CHANNEL[c].base[0];
      return {
        ...view,
        fromServices: fromServices.includes(c),
        headline: headline.label,
        trend: months.map((m) => ({ month: m, value: values.get(`${m}|${metricKey(c, headline.key)}`)?.value ?? null })),
        editable: CHANNEL[c].base.map((b) => ({ key: b.key, label: b.label, unit: b.unit, text: values.get(`${month}|${metricKey(c, b.key)}`)?.source === "MANUAL" ? metricText(b.unit, values.get(`${month}|${metricKey(c, b.key)}`)!.value) : "" })),
      };
    }),
    connections: PROVIDERS.map((p) => {
      const conn = connections.find((c) => c.provider === p);
      const adapter = analyticsProvider(p);
      return { provider: p, label: PROVIDER_LABEL[p], status: conn?.status ?? "NOT_CONNECTED", lastSyncedAt: conn?.lastSyncedAt?.toISOString() ?? null, lastError: conn?.lastError ?? null, live: adapter?.live() ?? false, channels: adapter?.channels ?? [] };
    }),
    mockSync: mockSyncEnabled(),
  };
}

/** Manual entry for one channel and month. A blank field removes that manual value (a synced one, if any, shows again). */
export async function saveManual(principal: Principal, clientId: string, month: string, channel: Channel, input: Record<string, string>) {
  if (!isMonth(month)) throw new ResultsError("Pick a month", 422, { month: "Pick a month" });
  if (month > (await currentMonth())) throw new ResultsError("That month hasn't happened yet", 422, { month: "A past or current month" });
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { organizationId: true } });
  const errors: Record<string, string> = {};
  const writes: { key: string; value: number | null }[] = [];
  for (const b of CHANNEL[channel].base) {
    const text = (input[b.key] ?? "").trim();
    if (!text) {
      writes.push({ key: b.key, value: null });
      continue;
    }
    const parsed = parseMetric(b.unit, text);
    if (!parsed.ok) errors[b.key] = parsed.error;
    else writes.push({ key: b.key, value: parsed.value });
  }
  if (Object.keys(errors).length) throw new ResultsError("Please fix the highlighted values", 422, errors);
  const periodStart = monthStart(month);
  await transaction(async (tx) => {
    for (const w of writes) {
      const where = { clientId_metricKey_source_granularity_periodStart: { clientId, metricKey: metricKey(channel, w.key), source: "MANUAL", granularity: "MONTH", periodStart } };
      if (w.value === null) await tx.metricValue.deleteMany({ where: where.clientId_metricKey_source_granularity_periodStart });
      else
        await tx.metricValue.upsert({
          where,
          create: { organizationId: client.organizationId!, clientId, metricKey: metricKey(channel, w.key), source: "MANUAL", granularity: "MONTH", periodStart, value: w.value, enteredById: principal.id },
          update: { value: w.value, enteredById: principal.id },
        });
    }
  });
}

/**
 * Pulls months from a provider. Live when the deployment has switched live
 * sync on; demo data in development when ANALYTICS_MOCK=true; otherwise it
 * refuses, and results come from manual entry.
 */
export async function syncProvider(clientId: string, provider: ProviderId, months: string[]) {
  const adapter = analyticsProvider(provider);
  if (!adapter) throw new ResultsError("Unknown provider", 404);
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { organizationId: true } });
  const connection = await prisma.integrationConnection.findUnique({ where: { clientId_provider: { clientId, provider } } });
  const mode = adapter.live() ? "live" : mockSyncEnabled() ? "mock" : null;
  if (!mode) throw new ResultsError(`${adapter.label} isn't connected yet — enter results by hand for now`, 409);
  let written = 0;
  try {
    for (const month of months) {
      const values = mode === "live" ? await adapter.fetchMonth({ clientId, accountId: connection?.accountLabel ?? null, month }) : adapter.channels.flatMap((c) => mockMonth(clientId, c, month));
      const source = mode === "live" ? provider : "MOCK";
      for (const v of values) {
        await prisma.metricValue.upsert({
          where: { clientId_metricKey_source_granularity_periodStart: { clientId, metricKey: v.metricKey, source, granularity: "MONTH", periodStart: monthStart(month) } },
          create: { organizationId: client.organizationId!, clientId, metricKey: v.metricKey, source, granularity: "MONTH", periodStart: monthStart(month), value: v.value, syncedAt: new Date() },
          update: { value: v.value, syncedAt: new Date() },
        });
        written += 1;
      }
    }
    await prisma.integrationConnection.upsert({
      where: { clientId_provider: { clientId, provider } },
      create: { organizationId: client.organizationId!, clientId, provider, status: mode === "live" ? "CONNECTED" : "MOCK", lastSyncedAt: new Date() },
      update: { status: mode === "live" ? "CONNECTED" : "MOCK", lastSyncedAt: new Date(), lastError: null },
    });
    return { mode, written };
  } catch (error) {
    const message = error instanceof IntegrationNotEnabled ? error.message : "The sync failed";
    await prisma.integrationConnection.upsert({
      where: { clientId_provider: { clientId, provider } },
      create: { organizationId: client.organizationId!, clientId, provider, status: "ERROR", lastError: message },
      update: { status: "ERROR", lastError: message },
    });
    throw new ResultsError(message, 502);
  }
}
