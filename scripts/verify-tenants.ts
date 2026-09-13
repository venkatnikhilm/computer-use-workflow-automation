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
assert.equal(artifact.provenance.kind, "llm-discovery");
const artifact_sha256 = createHash("sha256").update(bytes).digest("hex");
const records = [];
for (const tenant of ["harbor", "summit"]) {
  const profile = TenantProfile.parse(
    JSON.parse(readFileSync(`profiles/${tenant}.json`, "utf8")),
  );
  for (const member of ["12345", "67890"]) {
    const server = await startDemo(0, "normal", Date.now, tenant);
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
      const result = await replay(artifact, { member_id: member }, surface);
      assert.equal(result.status, "success");
      if (result.status === "success")
        assert.deepEqual(result.outputs, {
          balance: member === "12345" ? "100.00" : "2450.75",
          currency: "USD",
        });
      const name = `${tenant}-${records.filter((r) => r.tenant === tenant).length + 1}`;
      const directory = `evidence/tenant-reuse/${name}`;
      mkdirSync(directory, { recursive: true });
      copyFileSync(
        `${events.directory}/events.jsonl`,
        `${directory}/events.jsonl`,
      );
      const summary = {
        tenant,
        run_id: events.id,
        artifact_sha256,
        profile_digest: digest(profile),
        status: result.status,
        model_calls: 0,
        output_checked: true,
      };
      writeFileSync(
        `${directory}/summary.json`,
        JSON.stringify(summary, null, 2) + "\n",
      );
      records.push(summary);
      console.log(`${name}: success, zero model calls`);
    } finally {
      await surface.close();
      await new Promise<void>((r) => server.close(() => r()));
    }
  }
}
assert.equal(
  createHash("sha256")
    .update(readFileSync("capabilities/savings.json"))
    .digest("hex"),
  artifact_sha256,
);
writeFileSync(
  "evidence/tenant-reuse/manifest.json",
  JSON.stringify({ artifact_sha256, runs: records }, null, 2) + "\n",
);
