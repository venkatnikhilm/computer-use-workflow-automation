import {
  existsSync,
  readFileSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { startDemo } from "../demo/server.js";
import { Capability } from "../src/contracts.js";
import { Events } from "../src/events.js";
import { Session } from "../src/session.js";
import { Surface } from "../src/browser.js";
import { replay } from "../src/replay.js";

const file = process.argv[2] ?? "capabilities/savings.json";
const bytes = readFileSync(file);
const artifact = Capability.parse(JSON.parse(bytes.toString()));
assert.equal(
  artifact.provenance.kind,
  "llm-discovery",
  "This verifier requires a genuinely discovered artifact.",
);
const digest = createHash("sha256").update(bytes).digest("hex");
const records: unknown[] = [];
const scenarios = [
  {
    name: "different-member",
    mode: "normal",
    member: "67890",
    status: "success",
    balance: "2450.75",
  },
  {
    name: "member-not-found",
    mode: "normal",
    member: "99999",
    status: "business_outcome",
    code: "MEMBER_NOT_FOUND",
  },
  {
    name: "no-savings",
    mode: "normal",
    member: "11111",
    status: "business_outcome",
    code: "NO_SAVINGS_ACCOUNT",
  },
  {
    name: "ambiguous-account",
    mode: "normal",
    member: "22222",
    status: "business_outcome",
    code: "AMBIGUOUS_ACCOUNT",
  },
  {
    name: "slow-load",
    mode: "slow",
    member: "12345",
    status: "success",
    balance: "100.00",
  },
  {
    name: "unknown-state",
    mode: "unknown",
    member: "12345",
    status: "failure",
    code: "COMPLETION_NOT_MET",
  },
  {
    name: "simulated-handoff",
    mode: "auth",
    member: "12345",
    status: "success",
    balance: "100.00",
  },
];
for (const scenario of scenarios) {
  const server = await startDemo(0, scenario.mode);
  const address = server.address();
  assert(address && typeof address !== "string");
  const events = new Events("runs");
  const session = new Session(events, scenario.mode === "auth");
  process.env.TEST_HEADLESS = "1";
  const surface = new Surface(
    `http://127.0.0.1:${address.port}`,
    events,
    session,
  );
  try {
    await surface.open();
    const originalPage = surface.page;
    const pending = replay(artifact, { member_id: scenario.member }, surface);
    if (scenario.mode === "auth") {
      const until = Date.now() + 10000;
      while (!session.operatorURL && Date.now() < until)
        await new Promise((r) => setTimeout(r, 20));
      assert(session.operatorURL);
      // Explicit simulated operator; never label this as a real person's activity.
      await surface.page
        .getByRole("button", { name: "Restore demo session" })
        .click();
      await surface.page.locator("#account-kind").waitFor();
      assert.equal(
        (
          await fetch(session.operatorURL, {
            method: "POST",
            body: "action=resume",
          })
        ).status,
        200,
      );
    }
    const result = await pending;
    assert.equal(result.status, scenario.status);
    if (scenario.code)
      assert.equal("code" in result && result.code, scenario.code);
    if (scenario.balance)
      assert.deepEqual("outputs" in result && result.outputs, {
        balance: scenario.balance,
        currency: "USD",
      });
    assert.equal(surface.page, originalPage);
    const rows = readFileSync(join(events.directory, "events.jsonl"), "utf8");
    assert(!rows.includes("model_request"));
    const dir = join("evidence", scenario.name);
    mkdirSync(dir, { recursive: true });
    copyFileSync(
      join(events.directory, "events.jsonl"),
      join(dir, "events.jsonl"),
    );
    if (result.status !== "success")
      copyFileSync(
        join(events.directory, "failure.json"),
        join(dir, "failure.json"),
      );
    const summary = {
      scenario: scenario.name,
      artifact_sha256: digest,
      run_id: events.id,
      status: result.status,
      ...("code" in result ? { code: result.code } : {}),
      model_calls: 0,
      output_checked: Boolean(scenario.balance),
      operator: scenario.mode === "auth" ? "simulated" : "none",
    };
    writeFileSync(
      join(dir, "summary.json"),
      JSON.stringify(summary, null, 2) + "\n",
    );
    records.push(summary);
    console.log(`${scenario.name}: ${result.status}`);
  } finally {
    await surface.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
}
const discoveryDir = "evidence/discovery";
mkdirSync(discoveryDir, { recursive: true });
copyFileSync(file, join(discoveryDir, "capability.json"));
const discoveryEvents = readFileSync(
  existsSync(join("runs", artifact.provenance.run_id, "events.jsonl"))
    ? join("runs", artifact.provenance.run_id, "events.jsonl")
    : join(discoveryDir, "events.jsonl"),
  "utf8",
);
const rows = discoveryEvents
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
assert(
  rows.some(
    (row) =>
      row.type === "discovery_completed" &&
      row.run_id === artifact.provenance.run_id,
  ),
);
writeFileSync(join(discoveryDir, "events.jsonl"), discoveryEvents);
writeFileSync(
  "evidence/manifest.json",
  JSON.stringify(
    {
      artifact_sha256: digest,
      discovery: {
        run_id: artifact.provenance.run_id,
        kind: "live-model",
        api_attempts: rows.filter((row) => row.type === "model_request").length,
      },
      replays: records,
    },
    null,
    2,
  ) + "\n",
);
