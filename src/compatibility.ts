import { readFileSync } from "node:fs";
import { Capability, RunError } from "./contracts.js";
import { Task, Workflow, type WorkflowStepType } from "./workflow-contracts.js";
import { digest } from "./profile.js";

export function loadSavingsTask() {
  return Task.parse(
    JSON.parse(
      readFileSync(new URL("../tasks/savings.json", import.meta.url), "utf8"),
    ),
  );
}

/** Pure format conversion. Never executes browser actions or rewrites the source artifact. */
export function normalizeCapability(raw: unknown) {
  if (
    !raw ||
    typeof raw !== "object" ||
    !("schema_version" in raw) ||
    raw.schema_version !== 1
  )
    return raw;
  const parsed = Capability.safeParse(raw);
  if (!parsed.success) throw new RunError("INVALID_INVOCATION");
  const old = parsed.data;
  const task = loadSavingsTask();
  task.version = old.version;
  task.elements.record_identity = { candidates: [old.extraction.member] };
  task.elements.account_kind = { candidates: [old.extraction.account_kind] };
  task.elements.balance = { candidates: [old.extraction.balance] };
  task.elements.currency = { candidates: [old.extraction.currency] };
  // Preserve the original unknown-screen outcome: account identity is checked when
  // account-kind data exists, while a missing account screen fails completion.
  for (const rule of task.invariants) {
    if (
      rule.when.some((c) => c.kind === "path" && c.value === "/account") &&
      rule.require.some((c) => c.kind === "text_equals")
    )
      rule.when.push({ kind: "count", element: "account_kind", equals: 1 });
  }
  const steps: WorkflowStepType[] = old.steps.map((step, index) => {
    const element = `recorded_control_${index}`;
    task.elements[element] = { candidates: [step.target] };
    return step.action === "fill"
      ? {
          action: "fill",
          element,
          input: "member_id",
          postcondition: {
            kind: "field_equals",
            element,
            value: { input: "member_id" },
          },
        }
      : {
          action: "click",
          element,
          postcondition: {
            kind: "path",
            value:
              step.postcondition!.kind === "path"
                ? step.postcondition!.value
                : "/",
          },
        };
  });
  return Workflow.parse({
    ...task,
    steps,
    provenance: { ...old.provenance, task_digest: digest(task) },
  });
}
