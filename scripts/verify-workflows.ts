import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { startDemo } from "../demo/server.js";
import { Surface } from "../src/browser.js";
import { Events } from "../src/events.js";
import { Session } from "../src/session.js";
import {
  discoverWorkflow,
  type DecisionProvider,
} from "../src/workflow-discovery.js";
import { replayWorkflow } from "../src/workflow-runtime.js";
import { TenantProfile, harborProfile } from "../src/profile.js";
import { defaultPolicy } from "../src/policy.js";

const oldFetch = globalThis.fetch;
// Browser HTTP uses Playwright. Any accidental provider/API request from Node fails this verification.
globalThis.fetch = async () => {
  throw Error("Model/API calls forbidden in workflow verification");
};
const writeFixtures = process.argv.includes("--write-fixtures");
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
      for (const kind of ["savings", "member-contact"]) {
        const task = JSON.parse(readFileSync(`tasks/${kind}.json`, "utf8"));
        for (const member of ["12345", "67890"]) {
          const events = new Events("evidence/development");
          const surface = new Surface(
            `http://127.0.0.1:${address.port}`,
            events,
            new Session(events, false),
            defaultPolicy,
            profile,
          );
          try {
            await surface.open();
            const inputName = kind === "savings" ? "member_id" : "customer_ref";
            const file = `capabilities/examples/${kind}.v2.json`;
            if (writeFixtures && tenant === "harbor" && member === "12345") {
              const decisions = [
                { action: "click", element: "directory" },
                { action: "fill", element: "lookup_field", input: inputName },
                { action: "click", element: "search" },
                { action: "click", element: "open_record" },
                ...(kind === "savings"
                  ? [{ action: "click", element: "savings_link" }]
                  : []),
              ];
              const provider: DecisionProvider = async () => decisions.shift();
              const artifact = await discoverWorkflow(
                task,
                { [inputName]: member },
                surface,
                provider,
              );
              assert.equal(artifact.provenance.kind, "development-fixture");
              mkdirSync("capabilities/examples", { recursive: true });
              writeFileSync(file, JSON.stringify(artifact, null, 2) + "\n");
              await surface.page.goto(surface.base);
            }
            const result = await replayWorkflow(
              JSON.parse(readFileSync(file, "utf8")),
              { [inputName]: member },
              surface,
            );
            assert.equal(result.status, "success", JSON.stringify(result));
            if (kind === "savings")
              assert.equal(
                result.outputs?.balance,
                member === "12345" ? "100.00" : "2450.75",
              );
            else
              assert.equal(
                result.outputs?.email,
                member === "12345"
                  ? "alex@example.test"
                  : "jordan@example.test",
              );
            const logs = readFileSync(
              `${events.directory}/events.jsonl`,
              "utf8",
            );
            for (const value of [
              member,
              ...Object.values(result.outputs ?? {}),
            ]) {
              if (value !== "USD" && value !== "active")
                assert(!logs.includes(value));
            }
            console.log(
              `${tenant} / ${kind} / ${member === "12345" ? "first member" : "second member"}: success, zero model calls`,
            );
          } finally {
            await surface.close();
          }
        }
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
} finally {
  globalThis.fetch = oldFetch;
}
