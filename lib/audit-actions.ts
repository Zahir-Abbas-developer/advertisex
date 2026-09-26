/**
 * The audit log's action vocabulary, safe in client components (the log view
 * renders labels). lib/audit.ts writes rows and so holds the database client;
 * it re-exports these.
 */

export const AUDIT_ACTIONS = [
  "MILESTONE_APPROVED",
  "MILESTONE_REJECTED",
  "SCORE_ADJUSTED",
  "DISPUTE_FILED",
  "DISPUTE_RESOLVED",
  "CHECK_EXCUSED",
  "OUTAGE_REVIEWED",
  "BLOCK_VETOED",
  "ROLE_CHANGED",
  "LEAD_ASSIGNED",
  "SETTINGS_EDITED",
  "INCENTIVE_ACTIONED",
  "LEAVE_REVIEWED",
  "DEPARTMENT_CREATED",
  "DEPARTMENT_UPDATED",
  "DEPARTMENT_MEMBERS_CHANGED",
  "DEPARTMENT_FIELDS_CHANGED",
  "CLIENT_FIELDS_CHANGED",
  "DEPARTMENT_STAGES_CHANGED",
  "MODULE_TOGGLED",
  "PASSWORD_RESET",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  MILESTONE_APPROVED: "Approved work",
  MILESTONE_REJECTED: "Rejected work",
  SCORE_ADJUSTED: "Adjusted a score",
  DISPUTE_FILED: "Filed a dispute",
  DISPUTE_RESOLVED: "Resolved a dispute",
  CHECK_EXCUSED: "Excused a check",
  OUTAGE_REVIEWED: "Reviewed an outage",
  BLOCK_VETOED: "Overruled a block",
  ROLE_CHANGED: "Changed a role",
  LEAD_ASSIGNED: "Changed service leads",
  SETTINGS_EDITED: "Edited settings",
  INCENTIVE_ACTIONED: "Actioned an incentive",
  LEAVE_REVIEWED: "Reviewed leave",
  DEPARTMENT_CREATED: "Created a department",
  DEPARTMENT_UPDATED: "Edited a department",
  DEPARTMENT_MEMBERS_CHANGED: "Changed department members",
  DEPARTMENT_FIELDS_CHANGED: "Changed department fields",
  CLIENT_FIELDS_CHANGED: "Edited client fields",
  DEPARTMENT_STAGES_CHANGED: "Changed department pipeline",
  MODULE_TOGGLED: "Switched a module on or off",
  PASSWORD_RESET: "Reset a password",
};
