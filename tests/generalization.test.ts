import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startInventory } from "../demo/inventory.js";
import { Surface } from "../src/browser.js";
import { Events } from "../src/events.js";
import { Session } from "../src/session.js";
import { ApplicationProfile } from "../src/profile.js";
import { Policy } from "../src/policy.js";
import { discoverWorkflow } from "../src/workflow-discovery.js";
import { replayWorkflow } from "../src/workflow-runtime.js";

const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
async function setup(
  variant = "east",
  scenario = "normal",
  interactive = false,
) {
  const server = await startInventory(0, variant, scenario);
  const address = server.address();
  assert(address && typeof address !== "string");
  const events = new Events("evidence/development");
  const session = new Session(events, interactive, 10000);
  const surface = new Surface(
    `http://127.0.0.1:${address.port}`,
    events,
    session,
    Policy.parse(read("profiles/inventory-policy.json")),
    ApplicationProfile.parse(read(`profiles/inventory-${variant}.json`)),
  );
  await surface.open();
  return {
    surface,
    events,
    session,
    async close() {
      await surface.close();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
test("one inventory artifact replays on both applications variants and new record IDs", async () => {
  for (const variant of ["east", "west"]) {
    const x = await setup(variant);
    try {
      const result = await replayWorkflow(
        read("capabilities/examples/stock.json"),
        { item_code: "ITEM-B" },
        x.surface,
      );
      assert.equal(result.status, "success");
      assert.deepEqual(result.outputs, {
        units: "7",
        warehouse: "South depot",
      });
    } finally {
      await x.close();
    }
  }
});
test("legacy inference rejects duplicate nearby controls before dispatch", async () => {
  const x = await setup("east", "ambiguous");
  try {
    const result = await replayWorkflow(
      read("capabilities/examples/stock.json"),
      { item_code: "ITEM-A" },
      x.surface,
    );
    assert.equal(result.code, "AMBIGUOUS_TARGET");
    assert.equal(
      await x.surface.document().locator("input").first().inputValue(),
      "",
    );
  } finally {
    await x.close();
  }
});
test("observed-target discovery rejects invented controls and preserves missing-item business outcome", async () => {
  const x = await setup();
  try {
    await assert.rejects(
      discoverWorkflow(
        read("tasks/stock.json"),
        { item_code: "ITEM-A" },
        x.surface,
        async () => ({
          action: "click",
          target: { by: "role", role: "link", value: "Invented control" },
        }),
      ),
      /DISCOVERY_STUCK/,
    );
    const result = await replayWorkflow(
      read("capabilities/examples/stock.json"),
      { item_code: "ABSENT" },
      x.surface,
    );
    assert.equal(result.status, "business_outcome");
    assert.equal(result.code, "ITEM_NOT_FOUND");
  } finally {
    await x.close();
  }
});
test("new application control inference cannot authorize destructive forms", async () => {
  const x = await setup();
  try {
    await x.surface.page.goto(`${x.surface.base}/lookup`);
    const controls = (await x.surface.observe()).controls;
    assert(controls.some((c) => c.value === "Delete stock"));
    await assert.rejects(
      x.surface.performAction(
        {
          action: "click",
          target: { by: "role", role: "button", value: "Delete stock" },
        },
        {},
        async () => {},
      ),
      /POLICY_BLOCKED/,
    );
    assert.equal(new URL(x.surface.page.url()).pathname, "/lookup");
  } finally {
    await x.close();
  }
});
test("application identity and version are independently checked from configured markers", async () => {
  const x = await setup();
  try {
    await x.surface.page
      .locator("body")
      .evaluate((el) => el.setAttribute("data-release", "unknown"));
    await assert.rejects(x.surface.identity(), /UNSUPPORTED_APP_VERSION/);
    await x.surface.page.locator("body").evaluate((el) => {
      el.setAttribute("data-release", "2026.1");
      el.setAttribute("data-product", "other");
    });
    await assert.rejects(x.surface.identity(), /INCOMPATIBLE_APP/);
  } finally {
    await x.close();
  }
});
test("non-banking authentication blocker uses the existing handoff and validated resume", async () => {
  process.env.TEST_HEADLESS = "1";
  const x = await setup("east", "normal", true);
  try {
    x.surface.config.authentication.push({
      target: { by: "role", role: "heading", value: "Operator locked" },
      guidance: "Unlock this inventory console, then resume.",
    });
    await x.surface.page
      .locator("main")
      .evaluate((el) =>
        el.insertAdjacentHTML("afterbegin", "<h2>Operator locked</h2>"),
      );
    const waiting = x.surface.ensureAuthentication(async () => true);
    while (!x.session.operatorURL) await new Promise((r) => setTimeout(r, 10));
    assert.match(await x.session.guidance(), /inventory/);
    await x.surface.page
      .getByRole("heading", { name: "Operator locked" })
      .evaluate((el) => el.remove());
    // Exercise the public operator endpoint rather than bypassing ownership validation.
    const response = await fetch(x.session.operatorURL!, {
      method: "POST",
      body: new URLSearchParams({ action: "resume" }),
      redirect: "manual",
    });
    assert(response.status < 400);
    await waiting;
    assert.equal(x.session.assisted, true);
  } finally {
    await x.close();
    delete process.env.TEST_HEADLESS;
  }
});
