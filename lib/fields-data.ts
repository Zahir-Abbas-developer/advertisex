import { prisma } from "@/lib/prisma";
import { FieldEntity } from "@/lib/constants";
import {
  normalize,
  toFieldDefinitionView,
  visibleFields,
  type FieldDefinitionView,
  type FieldValueMap,
} from "@/lib/fields";

/**
 * The field engine's reads and writes — server-only, because it holds the
 * database client. The pure half (parsing, validation, visibility) is
 * lib/fields.ts, which client components import without pulling this in.
 */

/**
 * The active field set for one department and entity, in display order.
 *
 * Inactive definitions are excluded: a field an admin switched off should stop
 * appearing on forms, while the values already recorded against it stay in the
 * database rather than being destroyed by a toggle.
 */
export async function fieldsFor(
  departmentId: string,
  entity: FieldEntity,
): Promise<FieldDefinitionView[]> {
  const rows = await prisma.fieldDefinition.findMany({
    where: { departmentId, entity, isActive: true },
    orderBy: [{ order: "asc" }, { label: "asc" }],
  });
  return rows.map(toFieldDefinitionView);
}

/** Every definition for a department and entity, active or not — for Settings. */
export async function allFieldsFor(
  departmentId: string,
  entity: FieldEntity,
): Promise<FieldDefinitionView[]> {
  const rows = await prisma.fieldDefinition.findMany({
    where: { departmentId, entity },
    orderBy: [{ order: "asc" }, { label: "asc" }],
  });
  return rows.map(toFieldDefinitionView);
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------


export async function valuesFor(
  recordId: string,
  definitions: readonly FieldDefinitionView[],
): Promise<FieldValueMap> {
  if (definitions.length === 0) return {};
  const rows = await prisma.fieldValue.findMany({
    where: { recordId, fieldDefinitionId: { in: definitions.map((d) => d.id) } },
  });

  const keyById = new Map(definitions.map((d) => [d.id, d.key]));
  const out: FieldValueMap = {};
  for (const row of rows) {
    const key = keyById.get(row.fieldDefinitionId);
    if (key) out[key] = row.value;
  }
  return out;
}

/**
 * Values for many records at once.
 *
 * A list of 200 clients must not become 200 round trips; the browser and the
 * card grid both read through here.
 */
export async function valuesForMany(
  recordIds: readonly string[],
  definitions: readonly FieldDefinitionView[],
): Promise<Record<string, FieldValueMap>> {
  const out: Record<string, FieldValueMap> = {};
  for (const id of recordIds) out[id] = {};
  if (recordIds.length === 0 || definitions.length === 0) return out;

  const rows = await prisma.fieldValue.findMany({
    where: {
      recordId: { in: [...recordIds] },
      fieldDefinitionId: { in: definitions.map((d) => d.id) },
    },
  });

  const keyById = new Map(definitions.map((d) => [d.id, d.key]));
  for (const row of rows) {
    const key = keyById.get(row.fieldDefinitionId);
    if (!key) continue;
    (out[row.recordId] ??= {})[key] = row.value;
  }
  return out;
}

/**
 * Write a record's answers.
 *
 * An empty answer deletes the row rather than storing `""`, so "never answered"
 * and "answered with nothing" cannot drift apart. Only keys present in
 * `definitions` are touched — a payload naming another department's field is
 * ignored rather than trusted.
 */
export async function writeFieldValues(
  recordId: string,
  definitions: readonly FieldDefinitionView[],
  values: FieldValueMap,
): Promise<void> {
  const visible = visibleFields(definitions, values);
  const visibleIds = new Set(visible.map((d) => d.id));

  for (const definition of definitions) {
    const supplied = values[definition.key];
    if (supplied === undefined) continue;

    // A hidden field's answer is discarded: leaving the insurance answers on a
    // record whose category moved to "Cam" would show them again the moment it
    // moved back, as data nobody entered for that state.
    const stored = visibleIds.has(definition.id) ? normalize(definition, supplied) : "";

    if (stored === "") {
      await prisma.fieldValue.deleteMany({
        where: { fieldDefinitionId: definition.id, recordId },
      });
      continue;
    }

    await prisma.fieldValue.upsert({
      where: {
        fieldDefinitionId_recordId: { fieldDefinitionId: definition.id, recordId },
      },
      update: { value: stored },
      create: { fieldDefinitionId: definition.id, recordId, value: stored },
    });
  }
}

/**
 * Remove every answer belonging to a record.
 *
 * `FieldValue.recordId` is deliberately not a foreign key — the definition's
 * `entity` says which table it points at, and Prisma cannot express a relation
 * whose target depends on another column. Deleting a Lead or Client therefore
 * has to clear its values explicitly, and every delete path calls this.
 */
export async function deleteFieldValues(recordId: string): Promise<void> {
  await prisma.fieldValue.deleteMany({ where: { recordId } });
}
