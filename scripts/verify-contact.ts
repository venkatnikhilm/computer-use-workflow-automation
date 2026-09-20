import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { startDemo } from "../demo/server.js";
import { Surface } from "../src/browser.js";
import { Events } from "../src/events.js";
import { Session } from "../src/session.js";
import { Workflow, Task } from "../src/workflow-contracts.js";
import { replayWorkflow } from "../src/workflow-runtime.js";
import { TenantProfile, harborProfile, digest } from "../src/profile.js";
import { defaultPolicy } from "../src/policy.js";

const file = "capabilities/contact.discovered.v2.json";
const bytes = readFileSync(file);
const artifact = Workflow.parse(JSON.parse(bytes.toString()));
assert.equal(artifact.provenance.kind, "llm-discovery");
assert.equal(
  artifact.provenance.task_digest,
  digest(
    Task.parse(JSON.parse(readFileSync("tasks/member-contact.json", "utf8"))),
  ),
);
const discovery = readFileSync(
  "evidence/contact-v2/discovery/events.jsonl",
  "utf8",
)
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
assert(discovery.every((row) => row.run_id === artifact.provenance.run_id));
assert.equal(discovery.at(-1).type, "discovery_completed");
assert.equal(
  discovery.filter((row) => row.type === "model_request").length,
  artifact.provenance.api_attempts,
);
assert.deepEqual(
  readFileSync("evidence/contact-v2/discovery/capability.json"),
  bytes,
);
const artifactHash = createHash("sha256").update(bytes).digest("hex");
const records: unknown[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw Error("Provider/API requests are forbidden during replay verification");
};
try {
  for (const tenant of ["harbor", "summit"]) {
    const server = await startDemo(0, "normal", Date.now, tenant);
    const address = server.address();
    assert(address && typeof address !== "string");
    const profile =
      tenant === "harbor"
        ? harborProfile
        : TenantProfile.parse(
            JSON.parse(readFileSync("profiles/summit.json", "utf8")),
          );
    try {
      for (const [index, member] of ["12345", "67890", "99999"].entries()) {
        const events = new Events();
        const surface = new Surface(
          `http://127.0.0.1:${address.port}`,
          events,
          new Session(events, false),
          defaultPolicy,
          profile,
        );
        try {
          await surface.open();
          const result = await replayWorkflow(
            artifact,
            { customer_ref: member },
            surface,
          );
          if (member === "99999") {
            assert.equal(result.status, "business_outcome");
            assert.equal(result.code, "MEMBER_NOT_FOUND");
          } else {
            assert.equal(result.status, "success");
            assert.equal(result.assisted, false);
            assert.deepEqual(result.outputs, {
              email:
                member === "12345"
                  ? "alex@example.test"
                  : "jordan@example.test",
              phone: member === "12345" ? "202-555-0141" : "202-555-0182",
              membership_status: "active",
            });
          }
          const logs = readFileSync(`${events.directory}/events.jsonl`, "utf8");
          assert(!logs.includes('"model_request"'));
          for (const sensitive of [member, "@example.test", "202-555-"])
            assert(!logs.includes(sensitive));
          const name = `${tenant}-${member === "99999" ? "missing" : index + 1}`;
          const dir = `evidence/contact-v2/replays/${name}`;
          mkdirSync(dir, { recursive: true });
          copyFileSync(
            `${events.directory}/events.jsonl`,
            `${dir}/events.jsonl`,
          );
          if (member === "99999")
            copyFileSync(
              `${events.directory}/failure.json`,
              `${dir}/failure.json`,
            );
          const summary = {
            scenario: name,
            run_id: events.id,
            artifact_sha256: artifactHash,
            profile_digest: digest(profile),
            status: result.status,
            ...(result.code ? { code: result.code } : {}),
            model_calls: 0,
            output_checked: member !== "99999",
            operator: "none",
          };
          writeFileSync(
            `${dir}/summary.json`,
            JSON.stringify(summary, null, 2) + "\n",
          );
          records.push(summary);
          console.log(`${name}: ${result.status}, zero model calls`);
        } finally {
          await surface.close();
        }
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
  writeFileSync(
    "evidence/contact-v2/manifest.json",
    JSON.stringify(
      {
        artifact: file,
        artifact_sha256: artifactHash,
        discovery: {
          kind: "live-model",
          run_id: artifact.provenance.run_id,
          api_attempts: artifact.provenance.api_attempts,
        },
        replays: records,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  globalThis.fetch = originalFetch;
}
