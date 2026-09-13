import { readFileSync, mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { startDemo } from "../demo/server.js";
import { TenantProfile, digest } from "../src/profile.js";
import { defaultPolicy } from "../src/policy.js";
import { Surface } from "../src/browser.js";
import { Session } from "../src/session.js";
import { Events } from "../src/events.js";
import { replay } from "../src/replay.js";
const bytes = readFileSync("capabilities/savings.json");
const artifact = JSON.parse(bytes.toString());
const profile = TenantProfile.parse(
  JSON.parse(readFileSync("profiles/legacy.json", "utf8")),
);
const artifact_sha256 = createHash("sha256").update(bytes).digest("hex");
const records = [];
for (const scenario of ["legacy", "legacy-ambiguous"]) {
  const server = await startDemo(0, scenario);
  const a = server.address();
  assert(a && typeof a !== "string");
  const events = new Events();
  const surface = new Surface(
    `http://127.0.0.1:${a.port}`,
    events,
    new Session(events, false),
    defaultPolicy,
    profile,
  );
  try {
    await surface.open();
    const result = await replay(artifact, { member_id: "67890" }, surface);
    if (scenario === "legacy") {
      assert.equal(result.status, "success");
      assert.deepEqual(result.outputs, { balance: "2450.75", currency: "USD" });
    } else {
      assert.equal("code" in result && result.code, "AMBIGUOUS_TARGET");
      const failure = JSON.parse(
        readFileSync(`${events.directory}/failure.json`, "utf8"),
      );
      assert.equal(failure.diagnostics.matches, 2);
      assert.equal(failure.code, "AMBIGUOUS_TARGET");
    }
    const directory = `evidence/legacy/${scenario}`;
    mkdirSync(directory, { recursive: true });
    copyFileSync(
      `${events.directory}/events.jsonl`,
      `${directory}/events.jsonl`,
    );
    if (scenario !== "legacy")
      copyFileSync(
        `${events.directory}/failure.json`,
        `${directory}/failure.json`,
      );
    const summary = {
      scenario,
      run_id: events.id,
      artifact_sha256,
      profile_digest: digest(profile),
      status: result.status,
      code: "code" in result ? result.code : undefined,
      model_calls: 0,
      output_checked: scenario === "legacy",
    };
    writeFileSync(
      `${directory}/summary.json`,
      JSON.stringify(summary, null, 2) + "\n",
    );
    records.push(summary);
    console.log(`${scenario}: ${result.status}`);
  } finally {
    await surface.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
}
writeFileSync(
  "evidence/legacy/manifest.json",
  JSON.stringify({ artifact_sha256, runs: records }, null, 2) + "\n",
);
