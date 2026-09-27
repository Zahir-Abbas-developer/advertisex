import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { fieldErrors } from "@/lib/validation";
import { requireApi } from "@/modules/rbac/server";
import { BILLING_CADENCES, FALLBACK_STAGES, slugifyService } from "@/modules/services/catalog";

/**
 * The service catalog (Phase 4). Anyone who plans projects reads it (names,
 * stage templates, skills); prices are the founder's. `?all=1` includes
 * retired services, for the settings screen.
 */
export async function GET(request: Request) {
  const gate = await requireApi("read", "project");
  if (gate.response) return gate.response;
  const founder = gate.principal.role === "FOUNDER";
  const all = new URL(request.url).searchParams.get("all") === "1" && founder;

  const services = await prisma.serviceCatalog.findMany({
    where: all ? {} : { isActive: true },
    orderBy: { order: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      price: true,
      billing: true,
      isActive: true,
      stageTemplates: { select: { id: true, name: true, order: true }, orderBy: { order: "asc" } },
      skills: { select: { weight: true, skill: { select: { id: true, name: true } } }, orderBy: { weight: "desc" } },
    },
  });
  return NextResponse.json({
    services: services.map((s) => ({
      ...s,
      price: founder ? s.price : null,
      billing: founder ? s.billing : null,
      skills: s.skills.map((k) => ({ ...k.skill, weight: k.weight })),
    })),
  });
}

const serviceSchema = z
  .object({
    name: z.string().trim().min(2, "Name the service").max(80),
    description: z.string().trim().max(300).optional(),
    price: z.number().int().min(0).max(10_000_000).default(0),
    billing: z.enum(BILLING_CADENCES).default("ONE_TIME"),
    stages: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  })
  .strict();

export async function POST(request: Request) {
  const gate = await requireApi("manage", "admin", "Only the founder can do that");
  if (gate.response) return gate.response;

  const parsed = serviceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  const d = parsed.data;
  const last = await prisma.serviceCatalog.findFirst({ orderBy: { order: "desc" }, select: { order: true } });
  if (await prisma.serviceCatalog.findFirst({ where: { name: d.name }, select: { id: true } })) {
    return apiError("A service with that name already exists", 409, { name: "Already in the catalogue" });
  }
  // The slug is frozen once made, so a renamed service can still hold the
  // slug a new name would produce: take the first free one.
  const base = slugifyService(d.name) || "service";
  let slug = base;
  for (let n = 2; await prisma.serviceCatalog.findFirst({ where: { slug }, select: { id: true } }); n++) slug = `${base}-${n}`;
  const stages = d.stages?.length ? d.stages : [...FALLBACK_STAGES];

  try {
    const service = await prisma.serviceCatalog.create({
      data: {
        organizationId: gate.principal.organizationId,
        name: d.name,
        description: d.description,
        // Derived once, then frozen: it keys nothing a rename should move.
        slug,
        price: d.price,
        billing: d.billing,
        order: (last?.order ?? 0) + 1,
        stageTemplates: { create: stages.map((name, order) => ({ name, order })) },
      },
    });
    return NextResponse.json({ service }, { status: 201 });
  } catch {
    return apiError("A service with that name already exists", 409, { name: "Already in the catalogue" });
  }
}
