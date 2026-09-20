import { Dashboard } from "./dashboard.js";
import { TenantProfile, harborProfile, applicationConfig } from "./profile.js";
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { Events } from "./events.js";
import { Session } from "./session.js";
import { Surface } from "./browser.js";
import { replay } from "./replay.js";
import { Policy, defaultPolicy } from "./policy.js";
import { RunError } from "./contracts.js";
import { Task, Workflow, validateParameters } from "./workflow-contracts.js";
import { normalizeCapability, loadSavingsTask } from "./compatibility.js";
try {
  process.loadEnvFile(".env");
} catch {}
const mode = process.argv[2];
const member_id = process.argv[3] ?? "12345";
const file = process.argv[4] ?? "capabilities/savings.json";
const events = new Events();
const session = new Session(events, process.env.HEADED === "1");
const profile = process.env.PROFILE_FILE
  ? TenantProfile.parse(
      JSON.parse(readFileSync(process.env.PROFILE_FILE, "utf8")),
    )
  : harborProfile;
const surface = new Surface(
  process.env.DEMO_URL ?? profile.base_url,
  events,
  session,
  process.env.POLICY_FILE
    ? Policy.parse(JSON.parse(readFileSync(process.env.POLICY_FILE, "utf8")))
    : defaultPolicy,
  profile,
);
const dashboard = session.interactive
  ? new Dashboard(events, session, applicationConfig(profile).display_name)
  : undefined;
try {
  const operation =
    mode === "discover-workflow"
      ? "discover"
      : mode === "replay-workflow"
        ? "replay"
        : mode;
  if (operation !== "discover" && operation !== "replay")
    throw new RunError("INVALID_COMMAND");
  // Preserve historical positional calls; new calls always use a definition + JSON inputs.
  const historical = !process.argv[3] || /^\d{5}$/.test(process.argv[3]);
  const definition = historical
    ? operation === "discover"
      ? {
          ...loadSavingsTask(),
          ...(process.env.GOAL ? { goal: process.env.GOAL } : {}),
        }
      : JSON.parse(readFileSync(file, "utf8"))
    : JSON.parse(readFileSync(process.argv[3]!, "utf8"));
  const parameters = historical
    ? { member_id }
    : JSON.parse(process.argv[4] ?? "{}");
  const parsed =
    operation === "discover"
      ? Task.parse(definition)
      : Workflow.parse(normalizeCapability(definition));
  validateParameters(parsed, parameters);
  session.capabilityId = parsed.id;
  if (dashboard) console.log(`Dashboard: ${await dashboard.start()}`);
  await surface.open();
  if (operation === "discover") {
    const { discoverWorkflow } = await import("./workflow-discovery.js");
    const artifact = await discoverWorkflow(definition, parameters, surface);
    const output = historical
      ? file
      : (process.argv[5] ?? `capabilities/${artifact.id}.json`);
    mkdirSync("capabilities", { recursive: true });
    writeFileSync(output + ".tmp", JSON.stringify(artifact, null, 2));
    renameSync(output + ".tmp", output);
    console.log(`Saved ${output}`);
  } else {
    const result = await replay(definition, parameters, surface);
    console.log(JSON.stringify(result, null, 2));
    if (result.status === "failure" || result.status === "cancelled")
      process.exitCode = 1;
  }
} catch (error) {
  const code = error instanceof RunError ? error.code : "RUN_FAILED";
  events.emit("failure", { code });
  await surface.evidence();
  console.error(
    "Run failed (" + code + "). Sanitized evidence:",
    events.directory,
  );
  process.exitCode = 1;
} finally {
  await surface.close();
  if (dashboard) {
    dashboard.finish();
    console.log(
      "Dashboard result available for 60 seconds; then this command exits.",
    );
  }
}
