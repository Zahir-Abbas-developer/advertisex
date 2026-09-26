import { prisma } from "@/lib/prisma";
import { authorize, type Principal } from "@/modules/rbac/authorize";

/**
 * Who may see and change one task — the single answer every task
 * sub-resource (checklist, comments, files, history) uses, so none of them
 * can drift from the others or from the task itself.
 *
 * - **Read:** anyone who holds `task:read` over the task's department
 *   (founder everywhere; manager and employee in their own departments).
 * - **Write:** the founder; a manager in the task's department; otherwise the
 *   task's assignee or creator. A teammate in the same department can read
 *   and comment, but not rewrite someone else's work.
 *
 * Organization isolation comes from the data layer: a task from another
 * organization is simply not found.
 */

export type TaskAccess =
  | { ok: true; task: { id: string; title: string; departmentId: string; assigneeId: string | null; createdById: string | null } }
  | { ok: false; status: 403 | 404; error: string };

export async function taskAccess(
  principal: Principal,
  taskId: string,
  mode: "read" | "write",
): Promise<TaskAccess> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, title: true, departmentId: true, assigneeId: true, createdById: true, projectId: true },
  });
  if (!task) return { ok: false, status: 404, error: "That task no longer exists" };

  // Phase 4: a project's team works its tasks whatever their own departments.
  const onProject = task.projectId != null && principal.assignedProjectIds.includes(task.projectId);
  const target = { departmentId: task.departmentId, assigneeId: task.assigneeId, ownerId: task.createdById };
  if (!onProject && !authorize(principal, "read", "task", target).allowed) {
    // Indistinguishable from absent: outside your departments, it isn't there.
    return { ok: false, status: 404, error: "That task no longer exists" };
  }
  if (mode === "read") return { ok: true, task };

  const mine = task.assigneeId === principal.id || task.createdById === principal.id || onProject;
  const manages = principal.role === "FOUNDER" || principal.role === "MANAGER";
  if (!mine && !manages) return { ok: false, status: 403, error: "That's someone else's task" };
  return { ok: true, task };
}
