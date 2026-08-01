// Single source of truth for "enum" values.
// SQLite (Prisma connector) has no native enum type, so these are plain
// String columns in schema.prisma, validated at every write boundary via
// the zod schemas derived below. On Postgres these become native enums
// with no change to application code — see prisma/POSTGRES_MIGRATION.md.
import { z } from "zod";

export const WORKER_STATUSES = [
  "ACTIVE",
  "ON_LEAVE",
  "TERMINATION_PENDING",
  "TERMINATED",
  "CONTRACTOR",
] as const;
export type WorkerStatus = (typeof WORKER_STATUSES)[number];
export const WorkerStatusSchema = z.enum(WORKER_STATUSES);

export const TRACKS = ["IC", "M"] as const;
export type Track = (typeof TRACKS)[number];
export const TrackSchema = z.enum(TRACKS);

export const POSITION_STATUSES = ["OPEN", "FILLED", "CLOSED"] as const;
export type PositionStatus = (typeof POSITION_STATUSES)[number];
export const PositionStatusSchema = z.enum(POSITION_STATUSES);

export const EVENT_TYPES = [
  "HIRE",
  "TERMINATION",
  "TRANSFER",
  "COMP_CHANGE",
  "STATUS_CHANGE",
  "PROMOTION",
  "PROFILE_CHANGE",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export const EventTypeSchema = z.enum(EVENT_TYPES);

export const BP_STATUSES = ["IN_PROGRESS", "COMPLETED", "DENIED", "CANCELED"] as const;
export type BpStatus = (typeof BP_STATUSES)[number];
export const BpStatusSchema = z.enum(BP_STATUSES);

export const STEP_ACTIONS = ["PENDING", "APPROVED", "DENIED", "SKIPPED_BY_RULE", "SENT_BACK"] as const;
export type StepAction = (typeof STEP_ACTIONS)[number];
export const StepActionSchema = z.enum(STEP_ACTIONS);

export const ASSIGNEE_RULES = [
  "INITIATOR",
  "MANAGER_OF_WORKER",
  "SKIP_LEVEL_MANAGER",
  "HR_PARTNER",
  "COMP_PARTNER",
  // Added additively for the RBAC "Profile Change Request" workflow (see
  // security/roles.ts FIXED_ROLE_ASSIGNMENTS): resolves to the fixed HR Ops
  // worker if the initiator is a plain Employee, or the fixed HR Partner
  // worker if the initiator is a Manager/Skip Level Manager — the exact
  // routing table from the RBAC spec. Distinct from the existing HR_PARTNER
  // rule above (which resolves dynamically by G&A seniority for the
  // original Worker Data Change flow) — the two flows intentionally use
  // different resolution strategies and are not unified.
  "ROUTE_BASED_APPROVER",
] as const;
export type AssigneeRule = (typeof ASSIGNEE_RULES)[number];
export const AssigneeRuleSchema = z.enum(ASSIGNEE_RULES);

export const PERSONAS = [
  { key: "MANAGER", label: "Manager" },
  { key: "SKIP_LEVEL", label: "Skip-level Manager" },
  { key: "HR_PARTNER", label: "HR Partner" },
  { key: "COMP_PARTNER", label: "Comp Partner" },
] as const;
export type PersonaKey = (typeof PERSONAS)[number]["key"];

export const DEPARTMENTS = ["GPU Cloud", "On-Prem", "Engineering", "G&A"] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const CURRENCIES = ["USD", "GBP", "CAD", "INR"] as const;
export type Currency = (typeof CURRENCIES)[number];
