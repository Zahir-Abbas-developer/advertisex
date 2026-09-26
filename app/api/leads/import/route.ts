import { NextResponse } from "next/server";

import { prisma, transaction } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { canUseDepartment } from "@/lib/departments";
import { stagesFor } from "@/lib/stages";
import { requireApi } from "@/modules/rbac/server";
import { duplicateKey, parseCsv, validateImport } from "@/modules/leads/csv";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 5_000;

/**
 * CSV import for leads (Phase 3 scope 8). Two steps, same endpoint:
 *
 * - `mode=preview` validates every row and reports errors and duplicates
 *   (against existing leads and within the file). Nothing is written.
 * - `mode=commit` writes the valid rows — skipping duplicates unless
 *   `includeDuplicates=true` — in one transaction, each with its opening
 *   stage in the history. The data layer audit-logs every created lead.
 *
 * Founder and managers only: a bulk write is a management action.
 */
export async function POST(request: Request) {
  const access = await requireApi("create", "lead");
  if (access.response) return access.response;
  const principal = access.principal;
  if (principal.role !== "FOUNDER" && principal.role !== "MANAGER") {
    return apiError("Importing leads is for the founder and managers", 403);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError("Expected a CSV upload", 400);
  }
  const file = form.get("file");
  const departmentId = String(form.get("departmentId") ?? "");
  const mode = form.get("mode") === "commit" ? "commit" : "preview";
  const includeDuplicates = form.get("includeDuplicates") === "true";

  if (!(file instanceof File) || file.size === 0) return apiError("Choose a CSV file", 422, { file: "No file received" });
  if (file.size > MAX_BYTES) return apiError("That file is over 2 MB — split it and import in parts", 413, { file: "Too large" });
  if (!(await canUseDepartment(principal.id, principal.role === "FOUNDER", departmentId))) {
    return apiError("That department isn't one of yours", 403, { departmentId: "Pick one of your departments" });
  }

  const table = parseCsv(await file.text());
  if (table.length - 1 > MAX_ROWS) return apiError(`At most ${MAX_ROWS} rows per import`, 413);

  const [existingLeads, stages, members] = await Promise.all([
    prisma.lead.findMany({ select: { businessName: true, email: true, phone: true } }),
    stagesFor(departmentId),
    prisma.departmentMembership.findMany({
      where: { departmentId, user: { isActive: true } },
      select: { user: { select: { id: true, email: true } } },
    }),
  ]);
  const existing = new Map(
    existingLeads.map((l) => [duplicateKey({ email: l.email, businessName: l.businessName, phone: l.phone }), `${l.businessName} (already in the pipeline)`]),
  );
  const report = validateImport(table, existing);
  if (report.missingColumns.length) {
    return apiError(`The file needs these columns: ${report.missingColumns.join(", ")}`, 422, { file: "Missing columns" });
  }

  // Owner and stage are checked against this department — a CSV cannot
  // assign work to a stranger or invent a stage.
  const ownerByEmail = new Map(members.map((m) => [m.user.email.toLowerCase(), m.user.id]));
  const stageOf = (value?: string) => {
    if (!value) return stages.find((s) => s.kind === "OPEN")?.key ?? stages[0]?.key ?? null;
    const v = value.trim().toLowerCase();
    return stages.find((s) => s.key.toLowerCase() === v || s.label.toLowerCase() === v)?.key ?? null;
  };
  const rows = report.rows.map((row) => {
    if (!row.ok) return row;
    const errors: string[] = [];
    const stage = stageOf(row.data.stage);
    if (!stage) errors.push(`stage: "${row.data.stage}" isn't a stage in this pipeline`);
    const ownerId = row.data.owner_email ? ownerByEmail.get(row.data.owner_email) : principal.id;
    if (!ownerId) errors.push(`owner_email: ${row.data.owner_email} isn't a member of this department`);
    return errors.length ? { line: row.line, ok: false as const, errors } : { ...row, stage: stage!, ownerId: ownerId! };
  });

  const valid = rows.filter((r): r is Extract<typeof r, { ok: true }> & { stage: string; ownerId: string } => r.ok);
  const toWrite = valid.filter((r) => includeDuplicates || !r.duplicateOf);
  const summary = {
    total: rows.length,
    valid: valid.length,
    invalid: rows.length - valid.length,
    duplicates: valid.filter((r) => r.duplicateOf).length,
    willImport: toWrite.length,
  };

  if (mode === "preview") {
    return NextResponse.json({
      mode,
      summary,
      rows: rows.slice(0, 500).map((r) =>
        r.ok
          ? { line: r.line, ok: true, businessName: r.data.business_name, duplicateOf: r.duplicateOf }
          : { line: r.line, ok: false, errors: r.errors },
      ),
    });
  }

  const now = new Date();
  const created = await transaction(
    async (tx) => {
      let n = 0;
      for (const r of toWrite) {
        const d = r.data;
        const lead = await tx.lead.create({
          data: {
            departmentId,
            businessName: d.business_name,
            contactName: d.contact_name,
            email: d.email ?? null,
            phone: d.phone ?? null,
            website: d.website ?? null,
            location: d.location ?? null,
            country: d.country ?? null,
            industry: d.industry ?? null,
            source: d.source ?? "OUTREACH",
            sourceDetail: d.source_detail ?? null,
            dealValue: d.deal_value ?? 0,
            stage: r.stage,
            stageChangedAt: now,
            ownerId: r.ownerId,
            createdById: principal.id,
            tags: d.tags ?? "",
            notes: d.notes ?? null,
          },
        });
        await tx.leadStageEvent.create({
          data: { leadId: lead.id, departmentId, fromStage: null, toStage: r.stage, userId: principal.id, at: now },
        });
        n++;
      }
      return n;
    },
    { timeout: 120_000 },
  );

  return NextResponse.json({ mode, summary: { ...summary, imported: created } }, { status: 201 });
}
