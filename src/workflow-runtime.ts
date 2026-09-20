import { locate } from "./targeting.js";
import { normalizeCapability } from "./compatibility.js";
import type { Locator } from "playwright";
import type { Surface } from "./browser.js";
import { RunError } from "./contracts.js";
import { digest, resolveProfileTarget } from "./profile.js";
import {
  bind,
  validateParameters,
  validateValue,
  Workflow,
  type TaskType,
  type ConditionType,
  type WorkflowStepType,
  type Parameters,
} from "./workflow-contracts.js";

/** One execution context per invocation; application knowledge comes from the task and deployment profile. */
export class WorkflowRun {
  readonly input: Parameters;
  constructor(
    readonly task: TaskType,
    raw: unknown,
    readonly surface: Surface,
  ) {
    this.input = validateParameters(task, raw);
  }
  preflight(steps: WorkflowStepType[] = []) {
    if (this.task.application !== this.surface.profile.application)
      throw new RunError("INCOMPATIBLE_APP");
    const paths = [
      this.task.entry_path,
      ...steps.flatMap((s) =>
        s.action === "click" ? [s.postcondition.value] : [],
      ),
    ];
    if (
      paths.some((p) => !this.surface.policy.routes.includes(p)) ||
      steps.some((s) => !this.surface.policy.actions.includes(s.action))
    )
      throw new RunError("POLICY_PREFLIGHT_FAILED");
  }
  async start() {
    this.surface.check();
    if (
      new URL(this.surface.document().url()).pathname !== this.task.entry_path
    )
      throw new RunError("ENTRY_CHECKPOINT_MISMATCH");
    await this.guard();
  }
  async resolve(
    key: string,
    counting = false,
    recordDiagnostics = true,
  ): Promise<Locator | undefined> {
    const element = this.task.elements[key];
    if (!element) throw new RunError("INVALID_TARGET_REFERENCE");
    let scope: Locator | undefined;
    if (element.scope) {
      scope = this.surface.locator(element.scope);
      const count = await scope.count();
      if (count > 1) throw new RunError("AMBIGUOUS_SCOPE");
      if (!count) return undefined;
      if (!(await scope.isVisible())) return undefined;
    }
    for (let index = 0; index < element.candidates.length; index++) {
      const candidate = resolveProfileTarget(
        element.candidates[index]!,
        this.surface.profile,
      );
      const locator = scope
        ? locate(scope, candidate)
        : this.surface.locator(element.candidates[index]!);
      const matches = await locator.count();
      if (recordDiagnostics)
        this.surface.diagnostics = {
          ...this.surface.diagnostics,
          phase: "resolve_target",
          matches,
          candidate_index: index,
        };
      // Ambiguity never falls through to another candidate, including a positional selector.
      if (matches > 1 && !counting) throw new RunError("AMBIGUOUS_TARGET");
      if (matches) {
        if (recordDiagnostics)
          this.surface.events.emit("target_resolved", {
            candidate_index: index,
            match_count: matches,
          });
        return locator;
      }
    }
    return undefined;
  }
  async condition(c: ConditionType) {
    const url = new URL(this.surface.document().url());
    if (c.kind === "path") return url.pathname === c.value;
    if (c.kind === "query_equals")
      return url.searchParams.get(c.key) === bind(c.value, this.input);
    const target = await this.resolve(c.element, c.kind === "count", false);
    if (c.kind === "count")
      return (target ? await target.count() : 0) === c.equals;
    if (!target || !(await target.isVisible())) return false;
    const actual =
      c.kind === "field_equals"
        ? await target.inputValue()
        : await target.textContent();
    return actual === bind(c.value, this.input);
  }
  async all(conditions: ConditionType[]) {
    for (const c of conditions) if (!(await this.condition(c))) return false;
    return true;
  }
  async invariants() {
    if (
      this.surface.violation ||
      !this.surface.allowed(this.surface.document().url())
    )
      throw new RunError("POLICY_BLOCKED");
    await this.surface.identity();
    for (const rule of this.task.invariants)
      if ((await this.all(rule.when)) && !(await this.all(rule.require)))
        throw new RunError(rule.code);
  }
  async guard() {
    this.surface.check();
    await this.surface.ensureAuthentication(async () => {
      try {
        await this.invariants();
        return true;
      } catch {
        return false;
      }
    });
    this.surface.check();
    await this.invariants();
    const matching: string[] = [];
    for (const outcome of this.task.outcomes)
      if (await this.all(outcome.when)) matching.push(outcome.code);
    if (matching.length > 1) throw new RunError("AMBIGUOUS_OUTCOME");
    if (matching.length) throw new BusinessOutcome(matching[0]!);
  }
  async action(
    request: { action: "click" | "fill"; element: string; input?: string },
    checkpoint?: WorkflowStepType["postcondition"],
  ): Promise<WorkflowStepType> {
    await this.guard();
    const target = await this.resolve(request.element);
    if (!target) throw new RunError("TARGET_NOT_FOUND");
    if (
      request.action === "fill" &&
      (!request.input || !Object.hasOwn(this.input, request.input))
    )
      throw new RunError("INVALID_BINDING");
    const descriptor = this.task.elements[request.element]!.candidates[0]!;
    const result = await this.surface.performAction(
      {
        action: request.action,
        target: descriptor,
        input: request.input,
        ...(checkpoint?.kind === "path" ? { postcondition: checkpoint } : {}),
      },
      this.input,
      () => this.guard(),
      target,
    );
    await this.guard();
    const recorded: WorkflowStepType =
      request.action === "fill"
        ? {
            action: "fill",
            element: request.element,
            input: request.input!,
            postcondition: {
              kind: "field_equals",
              element: request.element,
              value: { input: request.input! },
            },
          }
        : {
            action: "click",
            element: request.element,
            postcondition: {
              kind: "path",
              value:
                result.postcondition.kind === "path"
                  ? result.postcondition.value
                  : "",
            },
          };
    if (!(await this.condition(checkpoint ?? recorded.postcondition)))
      throw new RunError("CHECKPOINT_MISMATCH");
    return recorded;
  }
  async outputs() {
    await this.guard();
    const outputs = await this.inspectOutputs();
    await this.guard();
    return outputs;
  }
  // Read-only validation also runs while the operator's resume request owns control.
  async inspectOutputs() {
    await this.invariants();
    if (!(await this.all(this.task.completion)))
      throw new RunError("COMPLETION_NOT_MET");
    const outputs: Parameters = {};
    for (const [key, definition] of Object.entries(this.task.outputs)) {
      const target = await this.resolve(definition.element);
      if (!target || !(await target.isVisible()))
        throw new RunError("OUTPUT_TARGET_INVALID");
      try {
        outputs[key] = validateValue(
          definition.field,
          await target.textContent(),
        );
      } catch {
        throw new RunError("INVALID_OUTPUT");
      }
    }
    // Recheck identity after extraction so stale or switched records cannot silently succeed.
    await this.invariants();
    if (!(await this.all(this.task.completion)))
      throw new RunError("COMPLETION_NOT_MET");
    return outputs;
  }
}
class BusinessOutcome extends RunError {}

export async function replayWorkflow(
  raw: unknown,
  args: unknown,
  surface: Surface,
) {
  let step = 0;
  try {
    const parsed = Workflow.safeParse(normalizeCapability(raw));
    if (!parsed.success) throw new RunError("INVALID_INVOCATION");
    const workflow = parsed.data;
    let run: WorkflowRun;
    try {
      run = new WorkflowRun(workflow, args, surface);
    } catch {
      throw new RunError("INVALID_INVOCATION");
    }
    run.preflight(workflow.steps);
    surface.session.capabilityId = workflow.id;
    surface.session.stepLabels = workflow.steps.map(
      (s) =>
        `${s.action === "fill" ? "Fill" : "Click"} ${s.element.replaceAll("_", " ")}`,
    );
    surface.events.emit("replay_started", {
      model_calls: 0,
      artifact_digest: digest(raw),
    });
    await run.start();
    for (const action of workflow.steps) {
      surface.stepIndex = step;
      try {
        await run.action(action, action.postcondition);
      } catch (error) {
        // These errors precede dispatch; do not retry timeouts or uncertain actions.
        if (
          !(error instanceof RunError) ||
          !surface.session.interactive ||
          !["TARGET_NOT_FOUND", "TARGET_NOT_ACTIONABLE"].includes(error.code)
        )
          throw error;
        await surface.intervene(error.code, async () => {
          try {
            await run.invariants();
            const target = await run.resolve(action.element);
            return Boolean(
              target &&
              (await target.isVisible()) &&
              (await target.isEnabled()),
            );
          } catch {
            return false;
          }
        });
        await run.action(action, action.postcondition);
      }
      surface.events.emit("step_completed", {
        step: step++,
        action: action.action,
      });
    }
    let outputs;
    try {
      outputs = await run.outputs();
    } catch (error) {
      if (
        !(error instanceof RunError) ||
        error.code !== "COMPLETION_NOT_MET" ||
        !surface.session.interactive
      )
        throw error;
      await surface.intervene(error.code, async () => {
        try {
          await run.inspectOutputs();
          return true;
        } catch {
          return false;
        }
      });
      outputs = await run.outputs();
    }
    surface.events.emit("success", {
      assisted: surface.session.assisted,
      model_calls: 0,
    });
    return { status: "success", outputs, assisted: surface.session.assisted };
  } catch (error) {
    const code = error instanceof RunError ? error.code : "EXECUTION_FAILED";
    const status =
      error instanceof BusinessOutcome
        ? "business_outcome"
        : code === "CANCELLED"
          ? "cancelled"
          : "failure";
    surface.events.emit(status, { code, step, model_calls: 0 });
    await surface.evidence();
    return { status, code, step, evidence: surface.events.directory };
  }
}
