"use server";
import { revalidatePath } from "next/cache";
import { startWorkerDataChange, actOnStep } from "./bp-engine";
import { createScenario, type ScenarioAssumptions } from "./planning";

export async function startChangeAction(formData: FormData) {
  const subjectWorkerId = String(formData.get("subjectWorkerId") ?? "").toUpperCase().trim();
  const initiatorId = String(formData.get("initiatorId") ?? "").toUpperCase().trim();
  const changeType = String(formData.get("changeType") ?? "COMP_CHANGE") as "COMP_CHANGE" | "TRANSFER";

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
  const actorWorkerId = String(formData.get("actorWorkerId") ?? "").toUpperCase().trim();
  const action = String(formData.get("action") ?? "") as "APPROVED" | "DENIED" | "SENT_BACK";
  const comment = String(formData.get("comment") ?? "").trim() || undefined;

  try {
    await actOnStep(stepInstanceId, actorWorkerId, action, comment);
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : "Failed to act on step");
  }
  revalidatePath("/processes");
  revalidatePath("/");
  revalidatePath("/workers");
}

export async function createScenarioAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const assumptionsRaw = String(formData.get("assumptions") ?? "{}");

  if (!name) throw new Error("Scenario name is required");
  let assumptions: ScenarioAssumptions;
  try {
    assumptions = JSON.parse(assumptionsRaw);
  } catch {
    throw new Error("Assumptions must be valid JSON");
  }
  if (!assumptions.hirePlan || !assumptions.attritionByDept || !assumptions.meritByLevel || !assumptions.meritEffectiveDate) {
    throw new Error("Assumptions JSON must include hirePlan, attritionByDept, meritByLevel, meritEffectiveDate");
  }

  await createScenario(name, description, assumptions);
  revalidatePath("/planning");
  revalidatePath("/planning/compare");
}
