import { z } from "zod";

import { LEAD_SOURCES, serializeTags, type LeadSource } from "@/modules/leads/domain";

/**
 * Lead CSV import/export (Phase 3 scope 8) — pure, unit-tested
 * (tests/leads-csv.test.ts). The route only reads the upload and writes the
 * rows this approves.
 */

/** Columns, in export order. Import accepts any order and ignores unknowns. */
export const CSV_COLUMNS = [
  "business_name",
  "contact_name",
  "email",
  "phone",
  "website",
  "location",
  "country",
  "industry",
  "source",
  "source_detail",
  "deal_value",
  "stage",
  "owner_email",
  "tags",
  "notes",
] as const;

// ---------------------------------------------------------------------------
// Parsing and writing (RFC 4180: quotes, doubled quotes, embedded commas and
// newlines)
// ---------------------------------------------------------------------------

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^﻿/, "");

  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** One CSV cell. Leading = + - @ are neutralized: a spreadsheet must never run a formula from a lead's name. */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || undefined)
    .optional();

const rowSchema = z.object({
  business_name: z.string().trim().min(2, "Business name is required").max(120),
  contact_name: z.string().trim().min(2, "Contact name is required").max(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(160)
    .refine((v) => v === "" || z.string().email().safeParse(v).success, "Not a valid email")
    .transform((v) => v || undefined)
    .optional(),
  phone: optionalText(40),
  website: optionalText(200),
  location: optionalText(120),
  country: optionalText(80),
  industry: optionalText(60),
  source: z
    .string()
    .trim()
    .toUpperCase()
    .transform((v) => v.replace(/[\s-]+/g, "_"))
    .refine((v) => v === "" || (LEAD_SOURCES as readonly string[]).includes(v), {
      message: `Source must be one of ${LEAD_SOURCES.join(", ")}`,
    })
    .transform((v) => (v || "OUTREACH") as LeadSource)
    .optional(),
  source_detail: optionalText(120),
  deal_value: z
    .string()
    .trim()
    .transform((v) => v.replace(/[$,\s]/g, ""))
    .refine((v) => v === "" || /^\d+(\.\d+)?$/.test(v), "Deal value must be a number")
    .transform((v) => (v === "" ? 0 : Math.round(Number(v))))
    .optional(),
  stage: optionalText(40),
  owner_email: z
    .string()
    .trim()
    .toLowerCase()
    .transform((v) => v || undefined)
    .optional(),
  tags: z
    .string()
    .transform((v) => serializeTags(v.split(",")))
    .optional(),
  notes: optionalText(2000),
});
export type ImportRow = z.output<typeof rowSchema>;

export type RowResult =
  | { line: number; ok: true; data: ImportRow; duplicateOf: string | null }
  | { line: number; ok: false; errors: string[] };

/** The key two records are duplicates by: email if there is one, else name + phone digits. */
export function duplicateKey(input: { email?: string | null; businessName: string; phone?: string | null }): string {
  if (input.email) return `email:${input.email.trim().toLowerCase()}`;
  const name = input.businessName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const phone = (input.phone ?? "").replace(/\D+/g, "").slice(-10);
  return `name:${name}|${phone}`;
}

/**
 * Validates every row and flags duplicates — against records that already
 * exist (`existing`: key → what it matches) and within the file itself. A
 * duplicate is reported, never silently merged or overwritten.
 */
export function validateImport(
  table: string[][],
  existing: ReadonlyMap<string, string>,
): { header: string[]; rows: RowResult[]; missingColumns: string[] } {
  const [rawHeader = [], ...body] = table;
  const header = rawHeader.map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const missingColumns = ["business_name", "contact_name"].filter((c) => !header.includes(c));
  if (missingColumns.length) return { header, rows: [], missingColumns };

  const seen = new Map<string, number>();
  const rows: RowResult[] = body.map((cells, i) => {
    const line = i + 2; // 1-based, after the header
    const record = Object.fromEntries(header.map((h, c) => [h, cells[c] ?? ""]));
    const parsed = rowSchema.safeParse(record);
    if (!parsed.success) {
      return { line, ok: false, errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "row"}: ${issue.message}`) };
    }
    const key = duplicateKey({ email: parsed.data.email, businessName: parsed.data.business_name, phone: parsed.data.phone });
    const inFile = seen.get(key);
    seen.set(key, line);
    const duplicateOf = existing.get(key) ?? (inFile ? `line ${inFile} of this file` : null);
    return { line, ok: true, data: parsed.data, duplicateOf };
  });
  return { header, rows, missingColumns };
}
