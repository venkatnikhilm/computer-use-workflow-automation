import assert from "node:assert/strict";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  existsSync,
} from "node:fs";
import { startInventory } from "../demo/inventory.js";
import { Surface } from "../src/browser.js";
import { Events } from "../src/events.js";
import { Session } from "../src/session.js";
import { TenantProfile, digest } from "../src/profile.js";
import { Policy } from "../src/policy.js";
import {
  discoverWorkflow,
  type DecisionProvider,
} from "../src/workflow-discovery.js";
import { replayWorkflow } from "../src/workflow-runtime.js";
import { Task, type WorkflowType } from "../src/workflow-contracts.js";

const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const task = Task.parse(read("tasks/stock.json"));
const policy = Policy.parse(read("profiles/inventory-policy.json"));
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw Error("No model/API calls permitted");
};
let artifact: WorkflowType | undefined;
const summaries: unknown[] = [];
try {
  for (const [variant, scenario, item] of [
    ["east", "normal", "ITEM-A"],
    ["east", "normal", "ITEM-B"],
    ["west", "normal", "ITEM-A"],
    ["west", "normal", "ITEM-B"],
    ["east", "normal", "ABSENT"],
    ["east", "ambiguous", "ITEM-A"],
  ] as const) {
    const server = await startInventory(0, variant, scenario);
    const address = server.address();
    assert(address && typeof address !== "string");
    const events = new Events("evidence/development");
    const surface = new Surface(
      `http://127.0.0.1:${address.port}`,
      events,
      new Session(events, false),
      policy,
      TenantProfile.parse(read(`profiles/inventory-${variant}.json`)),
    );
    try {
      await surface.open();
      if (!artifact) {
        // A fixture provider exercises actual perception and browser execution, not genuine LLM evidence.
        const provider: DecisionProvider = async ({ observation }) => {
          const observed = observation as Awaited<
            ReturnType<Surface["observe"]>
          >;
          const desired =
            observed.path === "/"
              ? "Stock lookup"
              : (await surface.document().locator("input").inputValue())
                ? "Find stock"
                : "Item code";
          const target = observed.controls.find((c) => c.value === desired);
          assert(target, "Control must be perceived from the actual page");
          return {
            action: target.by === "near_text" ? "fill" : "click",
            target,
            input: target.by === "near_text" ? "item_code" : null,
          };
        };
        artifact = await discoverWorkflow(
          task,
          { item_code: item },
          surface,
          provider,
        );
        assert.equal(artifact.provenance.kind, "development-fixture");
        assert.equal(artifact.provenance.task_digest, digest(task));
        assert.equal(artifact.steps.length, 3);
        assert(
          artifact.steps.every((s) => !Object.hasOwn(task.elements, s.element)),
        );
        mkdirSync("capabilities/examples", { recursive: true });
        writeFileSync(
          "capabilities/examples/stock.json",
          JSON.stringify(artifact, null, 2) + "\n",
        );
        await surface.page.goto(surface.base);
      }
      const result = await replayWorkflow(
        artifact,
        { item_code: item },
        surface,
      );
      if (scenario === "ambiguous")
        assert.equal(result.code, "AMBIGUOUS_TARGET");
      else if (item === "ABSENT") {
        assert.equal(result.status, "business_outcome");
        assert.equal(result.code, "ITEM_NOT_FOUND");
      } else {
        assert.equal(result.status, "success", JSON.stringify(result));
        assert.deepEqual(result.outputs, {
          units: item === "ITEM-A" ? "12" : "7",
          warehouse: item === "ITEM-A" ? "North depot" : "South depot",
        });
      }
      const eventsText = readFileSync(
        `${events.directory}/events.jsonl`,
        "utf8",
      );
      assert(!eventsText.includes(item));
      assert(!eventsText.includes('"type":"model_request"'));
      const caseName = `${variant}-${scenario}-${item === "ABSENT" ? "missing" : item === "ITEM-A" ? "first" : "second"}`;
      const evidencePath = `evidence/generalization/${caseName}`;
      mkdirSync(evidencePath, { recursive: true });
      copyFileSync(
        `${events.directory}/events.jsonl`,
        `${evidencePath}/events.jsonl`,
      );
      if (existsSync(`${events.directory}/failure.json`))
        copyFileSync(
          `${events.directory}/failure.json`,
          `${evidencePath}/failure.json`,
        );
      summaries.push({
        evidence: evidencePath,
        variant,
        scenario,
        status: result.status,
        code: result.code,
        artifact_digest: digest(artifact),
        model_calls: 0,
      });
      console.log(
        `inventory / ${variant} / ${scenario} / ${item === "ABSENT" ? "missing item" : "lookup"}: ${result.status}${result.code ? ` (${result.code})` : ""}, zero model calls`,
      );
    } finally {
      await surface.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
  mkdirSync("evidence/generalization", { recursive: true });
  writeFileSync(
    "evidence/generalization/manifest.json",
    JSON.stringify(
      {
        discovery: "development-fixture; injected provider, no live LLM",
        description:
          "One artifact, two inventory variants, changing input IDs, inferred action controls",
        runs: summaries,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  globalThis.fetch = originalFetch;
}
