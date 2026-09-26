import type { Progress, ProjectStatus, Schedule } from "@/modules/projects/domain";

/** The payload of GET /api/projects/[id]. */
export type ProjectPayload = {
  id: string;
  title: string;
  description: string | null;
  status: ProjectStatus;
  priority: string;
  startDate: string;
  deadline: string;
  completedAt: string | null;
  createdAt: string;
  client: { id: string; businessName: string };
  owner: { id: string; name: string; avatarColor: string } | null;
  services: { id: string; name: string }[];
  team: { id: string; name: string; avatarColor: string; jobTitle: string | null; role: string; projectRole: string }[];
  skills: { id: string; name: string; category: string; source: string }[];
  stages: { id: string; name: string; order: number; status: string; serviceId: string | null; service: string | null; startedAt: string | null; completedAt: string | null }[];
  currentStages: { id: string; name: string; service: string | null }[];
  milestones: {
    id: string;
    title: string;
    description: string | null;
    stageId: string | null;
    dueDate: string | null;
    status: "OPEN" | "DONE";
    weight: number;
    completedAt: string | null;
    assignee: { id: string; name: string; avatarColor: string } | null;
  }[];
  tasks: { id: string; title: string; status: string; priority: string; dueAt: string | null; assignee: { id: string; name: string; avatarColor: string } | null }[];
  upcoming: { id: string; kind: "MILESTONE" | "TASK"; title: string; dueAt: string | null }[];
  summary: { progress: Progress; schedule: Schedule; daysOverdue: number; openMilestones: number; openTasks: number };
};

export type ProjectViewer = {
  canShape: boolean;
  canWork: boolean;
  canDelete: boolean;
  canSeeCredentials: boolean;
  canSeeClient: boolean;
};
