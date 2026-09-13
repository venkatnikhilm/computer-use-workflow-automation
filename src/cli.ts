import { TenantProfile, harborProfile } from "./profile.js";
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { Events } from "./events.js";
import { Session } from "./session.js";
import { Surface } from "./browser.js";
import { replay } from "./replay.js";
import { Policy, defaultPolicy } from "./policy.js";
import { RunError } from "./contracts.js";
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
try {
  await surface.open();
  if (mode === "discover") {
    const { discover } = await import("./discovery.js");
    const artifact = await discover(
      process.env.GOAL ??
        "Find the requested member and return their current savings balance and currency.",
      { member_id },
      surface,
    );
    mkdirSync("capabilities", { recursive: true });
    writeFileSync(file + ".tmp", JSON.stringify(artifact, null, 2));
    renameSync(file + ".tmp", file);
    console.log(`Saved ${file}`);
  } else if (mode === "replay") {
    const result = await replay(
      JSON.parse(readFileSync(file, "utf8")),
      { member_id },
      surface,
    );
    console.log(JSON.stringify(result, null, 2));
    if (result.status === "failure") process.exitCode = 1;
  } else throw Error("Use discover or replay");
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
}
