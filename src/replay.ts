import { digest } from "./profile.js";
import { Capability, Input, RunError } from "./contracts.js";
import type { ExecutionSurface } from "./surface.js";
export async function replay(
  raw: unknown,
  args: unknown,
  surface: ExecutionSurface,
) {
  const parsedCapability = Capability.safeParse(raw);
  const parsedInput = Input.safeParse(args);
  if (!parsedCapability.success || !parsedInput.success) {
    surface.events.emit("failure", { code: "INVALID_INVOCATION" });
    return { status: "failure", code: "INVALID_INVOCATION", step: 0 };
  }
  const capability = parsedCapability.data;
  const input = parsedInput.data;
  surface.session.stepLabels = capability.steps.map((s) => {
    const labels: Record<string, string> = {
      Members: "Open member directory",
      "Member ID": "Enter member identifier",
      Search: "Search for member",
      "Open member": "Open member details",
      Savings: "Open savings account",
    };
    return (
      labels[s.target.value] ??
      (s.action === "fill" ? "Fill a field" : "Click a control")
    );
  });
  const forbidden = capability.steps.findIndex(
    (action) =>
      !surface.policy.actions.includes(action.action) ||
      (action.postcondition?.kind === "path" &&
        !surface.policy.routes.includes(action.postcondition.value)),
  );
  if (forbidden !== -1) {
    surface.events.emit("failure", {
      code: "POLICY_PREFLIGHT_FAILED",
      step: forbidden,
      model_calls: 0,
    });
    return {
      status: "failure",
      code: "POLICY_PREFLIGHT_FAILED",
      step: forbidden,
    };
  }
  surface.events.emit("replay_started", {
    model_calls: 0,
    artifact_digest: digest(raw),
  });
  let step = 0;
  try {
    for (const action of capability.steps) {
      surface.stepIndex = step;
      try {
        await surface.act(action, input);
      } catch (error) {
        if (
          surface.session.interactive &&
          error instanceof RunError &&
          ["TARGET_NOT_FOUND", "TARGET_NOT_ACTIONABLE"].includes(error.code)
        ) {
          await surface.intervene(error.code, () =>
            surface.canResumeAction(action),
          );
          await surface.act(action, input);
        } else throw error;
      }
      surface.events.emit("step_completed", {
        step: step++,
        action: action.action,
      });
    }
    let outputs;
    try {
      outputs = await surface.complete(input, capability.extraction);
    } catch (error) {
      if (
        surface.session.interactive &&
        error instanceof RunError &&
        error.code === "COMPLETION_NOT_MET"
      ) {
        await surface.intervene(error.code, async () => {
          try {
            await surface.verifyOutput(input, capability.extraction);
            return true;
          } catch {
            return false;
          }
        });
        outputs = await surface.complete(input, capability.extraction);
      } else throw error;
    }
    surface.events.emit("success", {
      assisted: surface.session.assisted,
      model_calls: 0,
    });
    return { status: "success", outputs, assisted: surface.session.assisted };
  } catch (error) {
    const code = error instanceof RunError ? error.code : "EXECUTION_FAILED";
    await surface.evidence();
    const business = [
      "MEMBER_NOT_FOUND",
      "NO_SAVINGS_ACCOUNT",
      "AMBIGUOUS_ACCOUNT",
    ].includes(code);
    surface.events.emit(business ? "business_outcome" : "failure", {
      code,
      step,
      model_calls: 0,
    });
    return {
      status: business
        ? "business_outcome"
        : code === "CANCELLED"
          ? "cancelled"
          : "failure",
      code,
      step,
      expected:
        step < capability.steps.length
          ? "unique permitted control and verified action effect"
          : "matching member savings account and valid balance",
      observed: code,
      evidence: surface.events.directory,
    };
  }
}
