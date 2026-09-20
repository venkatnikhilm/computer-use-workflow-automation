import type { Surface } from "./browser.js";
import { loadSavingsTask } from "./compatibility.js";
import { discoverWorkflow } from "./workflow-discovery.js";
export {
  WireDecision,
  parseDecision,
  discoverWorkflow,
} from "./workflow-discovery.js";
// Historical goal-string callers receive the savings task; there is only one loop.
export function discover(goal: string, args: unknown, surface: Surface) {
  return discoverWorkflow({ ...loadSavingsTask(), goal }, args, surface);
}
