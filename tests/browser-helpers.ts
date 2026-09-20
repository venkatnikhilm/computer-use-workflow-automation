// Historical tests exercise their original semantics through the shared runtime.
import { readFileSync } from "node:fs";
import type { Surface } from "../src/browser.js";
import type { StepType } from "../src/contracts.js";
import { normalizeCapability } from "../src/compatibility.js";
import { Workflow } from "../src/workflow-contracts.js";
import { WorkflowRun } from "../src/workflow-runtime.js";
export function testRun(
  surface: Surface,
  input: { member_id: string },
  extraction?: unknown,
) {
  const raw = JSON.parse(readFileSync("capabilities/savings.json", "utf8"));
  if (extraction) raw.extraction = extraction;
  return new WorkflowRun(
    Workflow.parse(normalizeCapability(raw)),
    input,
    surface,
  );
}
export function testAction(
  surface: Surface,
  step: StepType,
  input: { member_id: string },
) {
  return surface.performAction(step, input, () =>
    testRun(surface, input).guard(),
  );
}
