import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma, transaction } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { fieldErrors } from "@/lib/validation";
import { companyTimezone } from "@/lib/company-time";
import { authorize } from "@/modules/rbac/authorize";
import { requireApi } from "@/modules/rbac/server";
import { isMonthKey, monthOf } from "@/modules/attendance/server";
import { activityFor, attendanceFor, directoryFor, monthBounds, performanceFor } from "@/modules/team/server";

/**
 * One employee's profile: who they are, what they can do, what they carry,
 * how they deliver and attend, and what has happened — in one response.
 *
 * GET follows the directory scope (founder: anyone; manager: their
 * departments; employee: themselves). PATCH is the founder's.
 */
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const access = await requireApi("read", "employee");
  if (access.response) return access.response;

  const member = (await directoryFor(access.principal)).find((m) => m.id === params.id);
  if (!member) return apiError("That person isn't on your team", 404);

  const requested = new URL(request.url).searchParams.get("month");
  const timezone = await companyTimezone();
  const key = isMonthKey(requested) ? requested : monthOf(new Date(), timezone);
  const { from, to } = monthBounds(key, timezone);

  const [detail, performance, attendance, activity, tasks] = await Promise.all([
    prisma.user.findUnique({
      where: { id: member.id },
      select: {
        responsibilities: true,
        createdAt: true,
        schedule: true,
        agentGrants: { select: { resource: true, action: true } },
        skills: { select: { proficiency: true, skill: { select: { id: true, name: true, category: true } } } },
      },
    }),
    performanceFor([member], from, to),
    attendanceFor([member], key),
    activityFor(member.id),
    prisma.task.findMany({
      where: { assigneeId: member.id },
      orderBy: [{ completedAt: "desc" }, { dueAt: "asc" }],
      take: 60,
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        dueAt: true,
        completedAt: true,
        project: { select: { id: true, title: true, status: true } },
      },
    }),
  ]);

  return NextResponse.json({
    member,
    month: key,
    responsibilities: detail?.responsibilities ?? null,
    joinedAt: detail?.createdAt.toISOString() ?? null,
    schedule: detail?.schedule ?? null,
    capabilities: member.isAgent ? detail?.agentGrants ?? [] : [],
    skills: detail?.skills ?? [],
    performance: performance.get(member.id) ?? null,
    attendance: attendance.get(member.id) ?? null,
    activity,
    tasks: tasks.map((t) => ({
      ...t,
      dueAt: t.dueAt?.toISOString() ?? null,
      completedAt: t.completedAt?.toISOString() ?? null,
    })),
    canEdit: authorize(access.principal, "update", "employee").allowed,
  });
}

const patchSchema = z.object({
  jobTitle: z.string().trim().min(2).max(80).optional(),
  responsibilities: z.string().trim().max(2000).nullish(),
  weeklyCapacityHours: z.number().int().min(0).max(80).optional(),
  employmentStatus: z.enum(["ACTIVE", "ON_LEAVE", "INACTIVE"]).optional(),
  skills: z
    .array(z.object({ skillId: z.string().min(1), proficiency: z.number().int().min(1).max(5) }))
    .max(40)
    .optional(),
  schedule: z
    .object({
      timezone: z.string().min(3).max(64),
      workDays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
      startMinute: z.number().int().min(0).max(1439),
      endMinute: z.number().int().min(1).max(1440),
      graceMinutes: z.number().int().min(0).max(120),
    })
    .refine((s) => s.endMinute > s.startMinute, { message: "The day must end after it starts", path: ["endMinute"] })
    .refine(
      (s) => {
        try {
          new Intl.DateTimeFormat("en-US", { timeZone: s.timezone });
          return true;
        } catch {
          return false;
        }
      },
      { message: "That isn't a timezone we recognise", path: ["timezone"] },
    )
    .optional(),
});

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const access = await requireApi("update", "employee", "Only the founder can edit profiles");
  if (access.response) return access.response;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  const data = parsed.data;

  const user = await prisma.user.findUnique({ where: { id: params.id }, select: { id: true, organizationId: true } });
  if (!user) return apiError("That person no longer exists", 404);

  if (data.skills) {
    const known = await prisma.skill.count({ where: { id: { in: data.skills.map((s) => s.skillId) }, isActive: true } });
    if (known !== new Set(data.skills.map((s) => s.skillId)).size) {
      return apiError("Please fix the highlighted fields", 422, { skills: "One of those skills isn't in the catalog" });
    }
  }

  await transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        ...(data.jobTitle !== undefined ? { jobTitle: data.jobTitle } : {}),
        ...(data.responsibilities !== undefined ? { responsibilities: data.responsibilities || null } : {}),
        ...(data.weeklyCapacityHours !== undefined ? { weeklyCapacityHours: data.weeklyCapacityHours } : {}),
        ...(data.employmentStatus !== undefined ? { employmentStatus: data.employmentStatus } : {}),
      },
    });
    if (data.skills) {
      // The whole set: anything absent is removed.
      await tx.userSkill.deleteMany({
        where: { userId: user.id, skillId: { notIn: data.skills.map((s) => s.skillId) } },
      });
      for (const s of data.skills) {
        await tx.userSkill.upsert({
          where: { userId_skillId: { userId: user.id, skillId: s.skillId } },
          update: { proficiency: s.proficiency },
          create: { userId: user.id, skillId: s.skillId, proficiency: s.proficiency },
        });
      }
    }
    if (data.schedule) {
      const schedule = { ...data.schedule, workDays: [...new Set(data.schedule.workDays)].sort().join(",") };
      await tx.workSchedule.upsert({
        where: { userId: user.id },
        update: schedule,
        create: { userId: user.id, ...schedule },
      });
    }
  });

  return NextResponse.json({ ok: true });
}
