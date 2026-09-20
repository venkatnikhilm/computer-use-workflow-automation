import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { locate } from "../src/targeting.js";
import { observeControls, verifiedCandidates } from "../src/perception.js";
import { startInventory } from "../demo/inventory.js";
import { Surface } from "../src/browser.js";
import { Session } from "../src/session.js";
import { Events } from "../src/events.js";
import { ApplicationProfile } from "../src/profile.js";
import { Policy } from "../src/policy.js";
import { discoverWorkflow } from "../src/workflow-discovery.js";
import { replayWorkflow } from "../src/workflow-runtime.js";
import type { WorkflowType } from "../src/workflow-contracts.js";
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));

test("legacy perception finds referenced labels, wrapping labels, placeholders and titles", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<span id="a">Item</span><span id="b">code</span><input aria-labelledby="a b"><label>Postal code<input></label><input placeholder="Reference"><input title="Location">`,
    );
    const controls = (await observeControls(page)).flat();
    for (const target of [
      { by: "role", role: "textbox", value: "Item code" },
      { by: "label", value: "Postal code" },
      { by: "placeholder", value: "Reference" },
      { by: "title", value: "Location" },
    ] as const) {
      assert(
        controls.some((c) => c.by === target.by && c.value === target.value),
      );
      assert.equal(
        await locate(page, target).count(),
        1,
        JSON.stringify(target),
      );
    }
  } finally {
    await browser.close();
  }
});
test("nearest-row targeting isolates nested tables and safely handles quoted labels", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<table><tr><th>Outer label</th><td><table><tr><th>Owner's &quot;code&quot;</th><td><div><input></div></td></tr></table></td></tr></table>`,
    );
    assert.equal(
      await locate(page, { by: "near_text", value: "Outer label" }).count(),
      0,
    );
    assert.equal(
      await locate(page, { by: "near_text", value: `Owner's "code"` }).count(),
      1,
    );
    const groups = await observeControls(page);
    assert.deepEqual(groups.flat(), [
      { by: "near_text", value: `Owner's "code"` },
    ]);
  } finally {
    await browser.close();
  }
});
test("fallback builder excludes alternatives that also identify another field", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<label>Item code<input placeholder="Shared" title="Unique"></label><input placeholder="Shared">`,
    );
    const candidates = await verifiedCandidates(page, {
      by: "label",
      value: "Item code",
    });
    assert.deepEqual(candidates, [
      { by: "label", value: "Item code" },
      { by: "title", value: "Unique" },
    ]);
  } finally {
    await browser.close();
  }
});
test("discovered fallback survives lost label and rotating IDs; ambiguity still stops before filling", async () => {
  let artifact: WorkflowType | undefined;
  for (const scenario of ["labeled", "normal", "ambiguous"]) {
    const server = await startInventory(0, "east", scenario);
    const address = server.address();
    assert(address && typeof address !== "string");
    const events = new Events("evidence/development");
    const surface = new Surface(
      `http://127.0.0.1:${address.port}`,
      events,
      new Session(events, false),
      Policy.parse(read("profiles/inventory-policy.json")),
      ApplicationProfile.parse(read("profiles/inventory-east.json")),
    );
    try {
      await surface.open();
      if (!artifact) {
        artifact = await discoverWorkflow(
          read("tasks/stock.json"),
          { item_code: "ITEM-A" },
          surface,
          async ({ observation }) => {
            const view = observation as Awaited<ReturnType<Surface["observe"]>>;
            const value =
              view.path === "/"
                ? "Stock lookup"
                : (await surface.page.locator("input").inputValue())
                  ? "Find stock"
                  : "Item code";
            const target = view.controls.find((c) => c.value === value)!;
            return {
              action: target.by === "label" ? "fill" : "click",
              target,
              input: target.by === "label" ? "item_code" : null,
            };
          },
        );
        assert.deepEqual(
          artifact.elements.observed_control_1!.candidates.map((t) => t.by),
          ["label", "near_text", "placeholder", "title"],
        );
        assert(!JSON.stringify(artifact).includes("field-"));
        assert(!JSON.stringify(artifact).includes("label-"));
      } else {
        const result = await replayWorkflow(
          artifact,
          { item_code: "ITEM-B" },
          surface,
        );
        if (scenario === "normal") {
          assert.equal(result.status, "success", JSON.stringify(result));
          assert.equal(result.outputs?.units, "7");
          const logs = readFileSync(`${events.directory}/events.jsonl`, "utf8");
          assert(logs.includes('"candidate_index":1'));
          assert(!logs.includes("ITEM-B"));
        } else {
          assert.equal(result.code, "AMBIGUOUS_TARGET");
          assert.equal(
            await surface.page.locator("input").first().inputValue(),
            "",
          );
        }
      }
    } finally {
      await surface.close();
      await new Promise<void>((r) => server.close(() => r()));
    }
  }
});
