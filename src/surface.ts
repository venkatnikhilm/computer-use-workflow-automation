import type { z } from "zod";
import type { StepType, Extraction } from "./contracts.js";
import type { Events } from "./events.js";
import type { Session } from "./session.js";
import type { defaultPolicy } from "./policy.js";

/** Replay depends on operations and outcomes, not browser pages or locators.
 * A desktop adapter would implement these operations with accessibility controls.
 * Web target variants remain explicit and must be rejected by incompatible adapters. */
export interface ExecutionSurface {
  events: Events;
  session: Session;
  policy: typeof defaultPolicy;
  stepIndex: number;
  act(step: StepType, input: { member_id: string }): Promise<StepType>;
  complete(
    input: { member_id: string },
    extraction?: z.infer<typeof Extraction>,
  ): Promise<{ balance: string; currency: string }>;
  verifyOutput(
    input: { member_id: string },
    extraction?: z.infer<typeof Extraction>,
  ): Promise<{ balance: string; currency: string }>;
  canResumeAction(step: StepType): Promise<boolean>;
  intervene(code: string, validate: () => Promise<boolean>): Promise<void>;
  evidence(): Promise<void>;
}
