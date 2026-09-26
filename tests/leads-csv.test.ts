import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { csvCell, duplicateKey, parseCsv, toCsv, validateImport } from "../modules/leads/csv";

describe("CSV parsing", () => {
  it("reads quoted fields with commas, doubled quotes and newlines", () => {
    const table = parseCsv('a,b,c\n"Bao, Society","He said ""hi""","line1\nline2"\n');
    assert.deepEqual(table, [
      ["a", "b", "c"],
      ["Bao, Society", 'He said "hi"', "line1\nline2"],
    ]);
  });

  it("handles CRLF, a BOM and blank lines", () => {
    assert.deepEqual(parseCsv("﻿x,y\r\n1,2\r\n\r\n"), [["x", "y"], ["1", "2"]]);
  });

  it("round-trips what it writes", () => {
    const rows = [["name", "note"], ["Grind, Co", 'a "quote"'], ["plain", "multi\nline"]];
    assert.deepEqual(parseCsv(toCsv(rows)), rows);
  });

  it("neutralizes spreadsheet formulas on export", () => {
    assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
    assert.equal(csvCell("+1 555"), "'+1 555");
    assert.equal(csvCell("Osteria"), "Osteria");
  });
});

describe("import validation", () => {
  const header = "Business Name,Contact Name,Email,Phone,Source,Deal Value,Tags";

  it("accepts a good row and normalizes it", () => {
    const { rows } = validateImport(parseCsv(`${header}\nBao Society,Jenny Liu,JENNY@Bao.example,512 555 0187,paid ads,"$1,200",Brunch; ,VIP`), new Map());
    const row = rows[0];
    assert.ok(row.ok);
    if (row.ok) {
      assert.equal(row.data.email, "jenny@bao.example");
      assert.equal(row.data.source, "PAID_ADS");
      assert.equal(row.data.deal_value, 1200);
      assert.equal(row.duplicateOf, null);
    }
  });

  it("reports every problem on a bad row, with its line number", () => {
    const { rows } = validateImport(parseCsv(`${header}\nX,,not-an-email,,Carrier pigeon,lots,`), new Map());
    const row = rows[0];
    assert.equal(row.ok, false);
    if (!row.ok) {
      assert.equal(row.line, 2);
      assert.ok(row.errors.some((e) => e.startsWith("business_name")));
      assert.ok(row.errors.some((e) => e.startsWith("contact_name")));
      assert.ok(row.errors.some((e) => e.startsWith("email")));
      assert.ok(row.errors.some((e) => e.startsWith("source")));
      assert.ok(row.errors.some((e) => e.startsWith("deal_value")));
    }
  });

  it("refuses a file missing the required columns", () => {
    assert.deepEqual(validateImport(parseCsv("email\na@b.co"), new Map()).missingColumns, ["business_name", "contact_name"]);
  });

  it("flags duplicates of existing records and within the file", () => {
    const existing = new Map([[duplicateKey({ email: "marco@osteria.example", businessName: "Osteria Nonna" }), "Osteria Nonna (existing lead)"]]);
    const { rows } = validateImport(
      parseCsv(`${header}\nOsteria Nonna,Marco,Marco@Osteria.example,,,,\nNew Place,Ann,,555-0100,,,\nNew  Place!,Ann B,,(555) 0100,,,`),
      existing,
    );
    assert.equal(rows[0].ok && rows[0].duplicateOf, "Osteria Nonna (existing lead)");
    assert.equal(rows[1].ok && rows[1].duplicateOf, null);
    assert.equal(rows[2].ok && rows[2].duplicateOf, "line 3 of this file");
  });
});

describe("duplicate keys", () => {
  it("prefers email, case-insensitively", () => {
    assert.equal(duplicateKey({ email: " A@B.co ", businessName: "x" }), "email:a@b.co");
  });

  it("falls back to name and the last ten phone digits", () => {
    assert.equal(
      duplicateKey({ businessName: "Bao Society", phone: "+1 (512) 555-0187" }),
      duplicateKey({ businessName: "bao-society", phone: "512.555.0187" }),
    );
  });
});
