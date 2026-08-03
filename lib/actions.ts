"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { startWorkerDataChange, actOnStep, startProfileChangeRequest } from "./bp-engine";
import { createScenario, updateScenario, duplicateScenario, deleteScenario, type ScenarioAssumptions } from "./planning";
import { createHire } from "./hire";
import { acknowledgeAnomaly, unacknowledgeAnomaly } from "./anomaly-ack";
import { WORKER_COOKIE } from "./persona-constants";
import type { LevelCode } from "./reference-data";
import { getAuthContext } from "./auth-context";
import { assertPermission } from "@/security/routeGuard";
import { Permission } from "@/security/permissions";
import { effectiveWorkerId, canEditEmployee } from "@/security/authorization";
import { startProxySession, endProxySession, searchEmployees, type EmployeeSearchResult } from "@/security/proxy";

export async function startChangeAction(formData: FormData) {
  const subjectWorkerId = String(formData.get("subjectWorkerId") ?? "").toUpperCase().trim();
  const changeType = String(formData.get("changeType") ?? "COMP_CHANGE") as "COMP_CHANGE" | "TRANSFER";

  // Identity comes from the session, never from client-supplied FormData
  // (QA-001/QA-related fix: the prior version trusted an `initiatorId`
  // field, so any caller could name themselves as anyone and propose a
  // change for any worker with no authorization check at all). Mirrors
  // startProfileChangeAction's already-correct pattern.
  const ctx = await getAuthContext();
  const initiatorId = effectiveWorkerId(ctx);
  if (!(await canEditEmployee(ctx, subjectWorkerId))) {
    throw new Error("You are not authorized to start a data change for this worker");
  }

  try {
    if (changeType === "COMP_CHANGE") {
      const newSalary = Number(formData.get("newSalary"));
      const currency = String(formData.get("currency") ?? "USD");
      await startWorkerDataChange({ subjectWorkerId, initiatorId, changeType, newSalary, currency });
    } else {
      const newManagerId = String(formData.get("newManagerId") ?? "").toUpperCase().trim();
      const newLocationId = String(formData.get("newLocationId") ?? "").trim() || undefined;
      await startWorkerDataChange({ subjectWorkerId, initiatorId, changeType, newManagerId, newLocationId });
    }
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : "Failed to start business process");
  }
  revalidatePath("/processes");
}

export async function actOnStepAction(formData: FormData) {
  const stepInstanceId = String(formData.get("stepInstanceId") ?? "");
  const action = String(formData.get("action") ?? "") as "APPROVED" | "DENIED" | "SENT_BACK";
  const comment = String(formData.get("comment") ?? "").trim() || undefined;

  // Identity from the session, not from client-supplied FormData — the BP
  // audit trail's "who approved this" attribution must be server-verified,
  // not merely whatever the client claimed (see QA_REPORT.md §6.1).
  const ctx = await getAuthContext();
  const actorWorkerId = effectiveWorkerId(ctx);

  try {
    await actOnStep(stepInstanceId, actorWorkerId, action, comment);
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : "Failed to act on step");
  }
  revalidatePath("/processes");
  revalidatePath("/");
  revalidatePath("/workers");
}

// Self-service "Profile Change Request" — a second BpDefinition running on
// the same generic engine (see lib/bp-engine.ts's startProfileChangeRequest
// doc comment). subjectWorkerId defaults to the initiator (requesting a
// change to your own record); a Manager/Skip-Level may instead request one
// for a report they can edit — routing then resolves to HR Partner instead
// of HR Ops (security/README.md "Workflow authorization").
export async function startProfileChangeAction(formData: FormData) {
  const ctx = await getAuthContext();
  const initiatorId = effectiveWorkerId(ctx);
  const subjectWorkerId = (String(formData.get("subjectWorkerId") ?? "").toUpperCase().trim()) || initiatorId;
  const field = String(formData.get("field") ?? "") as "legalName" | "preferredName";
  const newValue = String(formData.get("newValue") ?? "").trim();

  if (subjectWorkerId !== initiatorId && !(await canEditEmployee(ctx, subjectWorkerId))) {
    throw new Error("You are not authorized to request a profile change for this worker");
  }
  if (field !== "legalName" && field !== "preferredName") {
    throw new Error("Choose which field to change");
  }

  try {
    await startProfileChangeRequest({ subjectWorkerId, initiatorId, field, newValue });
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : "Failed to submit profile change request");
  }
  revalidatePath(`/workers/${subjectWorkerId}`);
  revalidatePath("/inbox");
  revalidatePath("/home");
}

// Self-service profile photo upload — every persona gets this as a "My
// Tasks" prompt on /home (see app/home/page.tsx) until they upload one.
// Deliberately self-only (no on-behalf-of case, unlike Worker Data Change
// or Profile Change Request): a photo isn't governed data, so there's no
// approval step — it applies immediately, same as any other
// EDIT_OWN_PROFILE action.
const MAX_PHOTO_DATA_URL_LENGTH = 2_800_000; // ~2MB source image, base64-inflated (~1.37x) plus data: URI prefix
export async function uploadProfilePhotoAction(dataUrl: string): Promise<void> {
  const ctx = await getAuthContext();
  const workerId = effectiveWorkerId(ctx);

  if (!dataUrl.startsWith("data:image/")) throw new Error("Please choose an image file");
  if (dataUrl.length > MAX_PHOTO_DATA_URL_LENGTH) throw new Error("That image is too large — please choose a photo under 2MB");

  await prisma.worker.update({ where: { id: workerId }, data: { photoUrl: dataUrl } });
  revalidatePath(`/workers/${workerId}`);
  revalidatePath("/profile");
  revalidatePath("/home");
}

export async function createScenarioAction(input: { name: string; description: string; assumptions: ScenarioAssumptions }): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new Error("Scenario name is required");
  const scenario = await createScenario(name, input.description.trim(), input.assumptions);
  revalidatePath("/planning");
  revalidatePath("/planning/compare");
  return scenario.id;
}

export async function updateScenarioAction(input: { id: string; name?: string; description?: string; assumptions?: ScenarioAssumptions }): Promise<void> {
  if (input.name !== undefined && !input.name.trim()) throw new Error("Scenario name cannot be empty");
  await updateScenario(input.id, {
    name: input.name?.trim(),
    description: input.description?.trim(),
    assumptions: input.assumptions,
  });
  revalidatePath("/planning");
  revalidatePath("/planning/compare");
}

export async function duplicateScenarioAction(input: { id: string; newName: string }): Promise<string> {
  const newName = input.newName.trim();
  if (!newName) throw new Error("New scenario name is required");
  const scenario = await duplicateScenario(input.id, newName);
  revalidatePath("/planning");
  revalidatePath("/planning/compare");
  return scenario.id;
}

export async function deleteScenarioAction(id: string): Promise<void> {
  await deleteScenario(id);
  revalidatePath("/planning");
  revalidatePath("/planning/compare");
}

export async function createHireAction(formData: FormData) {
  // Authorization goes through the RBAC engine now (security/authorization.ts)
  // rather than a raw persona-string comparison — checked server-side too
  // since the client already hides the form for unauthorized roles, but a
  // direct action call shouldn't silently trust that.
  const ctx = await getAuthContext();
  assertPermission(ctx, Permission.ADD_EMPLOYEE, "Only HR Partner can create a new employee");

  const legalName = String(formData.get("legalName") ?? "").trim();
  const countryCode = String(formData.get("countryCode") ?? "US");
  const locationId = String(formData.get("locationId") ?? "");
  const level = String(formData.get("level") ?? "IC1") as LevelCode;
  const managerId = String(formData.get("managerId") ?? "");
  const annualSalary = Number(formData.get("annualSalary"));
  const hireDateRaw = String(formData.get("hireDate") ?? "");
  const hireDate = hireDateRaw ? new Date(hireDateRaw) : new Date();

  let workerId: string;
  try {
    workerId = await createHire({ legalName, countryCode, locationId, level, managerId, annualSalary, hireDate });
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : "Failed to create employee");
  }
  revalidatePath("/workers");
  revalidatePath("/");
  return workerId;
}

export async function acknowledgeAnomalyAction(input: { key: string; comment?: string }): Promise<void> {
  const ctx = await getAuthContext();
  assertPermission(ctx, Permission.VIEW_PAYROLL, "Only Payroll Admin (or a role with payroll access) can acknowledge anomalies");
  const actorId = effectiveWorkerId(ctx);
  await acknowledgeAnomaly(input.key, actorId, input.comment?.trim() || undefined);
  revalidatePath("/payroll");
}

export async function unacknowledgeAnomalyAction(key: string): Promise<void> {
  await unacknowledgeAnomaly(key);
  revalidatePath("/payroll");
}

export async function startProxyAction(targetWorkerId: string): Promise<{ allowed: boolean; reason?: string }> {
  const actualWorkerId = (cookies().get(WORKER_COOKIE)?.value || "").toUpperCase();
  const result = await startProxySession(actualWorkerId, targetWorkerId.toUpperCase());
  revalidatePath("/", "layout");
  return result;
}

export async function endProxyAction(proxyWorkerId: string): Promise<void> {
  const actualWorkerId = (cookies().get(WORKER_COOKIE)?.value || "").toUpperCase();
  await endProxySession(actualWorkerId, proxyWorkerId.toUpperCase());
  revalidatePath("/", "layout");
}

export async function searchEmployeesAction(query: string): Promise<EmployeeSearchResult[]> {
  return searchEmployees(query);
}
