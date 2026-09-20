import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { startDemo } from "../demo/server.js";
import { Surface } from "../src/browser.js";
import { Events } from "../src/events.js";
import { Session } from "../src/session.js";
import { defaultPolicy } from "../src/policy.js";
import {
  Task,
  Workflow,
  validateParameters,
} from "../src/workflow-contracts.js";
import { WorkflowRun, replayWorkflow } from "../src/workflow-runtime.js";
import { discoverWorkflow } from "../src/workflow-discovery.js";
import { TenantProfile, harborProfile } from "../src/profile.js";

function artifact(kind = "member-contact") {
  return Workflow.parse(
    JSON.parse(readFileSync(`capabilities/examples/${kind}.v2.json`, "utf8")),
  );
}
function task(kind = "member-contact") {
  return Task.parse(JSON.parse(readFileSync(`tasks/${kind}.json`, "utf8")));
}
async function setup(scenario = "normal", interactive = false) {
  const server = await startDemo(0, scenario);
  const a = server.address();
  assert(a && typeof a !== "string");
  const events = new Events("evidence/development");
  const profile = scenario.startsWith("legacy")
    ? TenantProfile.parse(
        JSON.parse(readFileSync("profiles/legacy.json", "utf8")),
      )
    : harborProfile;
  const session = new Session(events, interactive, 10000);
  const surface = new Surface(
    `http://127.0.0.1:${a.port}`,
    events,
    session,
    defaultPolicy,
    profile,
  );
  await surface.open();
  return {
    surface,
    events,
    session,
    close: async () => {
      await surface.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

test("v2 schemas reject unknown references and mismatched fill checkpoints before execution", () => {
  const good = artifact();
  for (const mutate of [
    (x: typeof good) => {
      x.steps[0]!.element = "unknown";
    },
    (x: typeof good) => {
      x.outputs.email!.element = "unknown";
    },
    (x: typeof good) => {
      x.completion.push({
        kind: "text_equals",
        element: "record_identity",
        value: { input: "unknown" },
      });
    },
    (x: typeof good) => {
      const s = x.steps[1]!;
      if (s.action === "fill") s.postcondition.element = "directory";
    },
  ]) {
    const changed = structuredClone(good);
    mutate(changed);
    assert.equal(Workflow.safeParse(changed).success, false);
  }
  assert.throws(() => validateParameters(task(), { member_id: "12345" }));
  assert.throws(() =>
    validateParameters(task(), { customer_ref: "12345", extra: "x" }),
  );
  assert.throws(() => validateParameters(task(), { customer_ref: 12345 }));
  assert.throws(() => validateParameters(task(), { customer_ref: "1234" }));
});

test("documented workflow CLI accepts JSON inputs and reports the selected task's outputs", async () => {
  const x = await setup();
  try {
    const result = await promisify(execFile)(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/cli.ts",
        "replay",
        "capabilities/examples/member-contact.v2.json",
        '{"customer_ref":"67890"}',
      ],
      {
        env: {
          ...process.env,
          DEMO_URL: x.surface.base,
          HEADED: "0",
          PROFILE_FILE: "",
          POLICY_FILE: "",
        },
        timeout: 15000,
      },
    );
    assert.equal(
      JSON.parse(result.stdout).outputs.email,
      "jordan@example.test",
    );
    assert.equal(JSON.parse(result.stdout).status, "success");
  } finally {
    await x.close();
  }
});

test("mock discovery chooses a sequence, records symbolic bindings, and replays different contact details", async () => {
  const x = await setup();
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw Error("No external calls");
  };
  try {
    const requests = [
      { action: "click", element: "directory" },
      { action: "fill", element: "lookup_field", input: "customer_ref" },
      { action: "click", element: "search" },
      { action: "click", element: "open_record" },
    ];
    const discovered = await discoverWorkflow(
      task(),
      { customer_ref: "12345" },
      x.surface,
      async () => requests.shift(),
    );
    assert.equal(discovered.provenance.kind, "development-fixture");
    assert.equal(discovered.steps.length, 4);
    assert(!JSON.stringify(discovered).includes("12345"));
    assert(!JSON.stringify(discovered).includes("alex@example.test"));
    await x.surface.page.goto(x.surface.base);
    const result = await replayWorkflow(
      discovered,
      { customer_ref: "67890" },
      x.surface,
    );
    assert.equal(result.status, "success");
    assert.deepEqual(result.outputs, {
      email: "jordan@example.test",
      phone: "202-555-0182",
      membership_status: "active",
    });
    assert.equal(x.session.capabilityId, "get_member_contact");
    const logs = readFileSync(`${x.events.directory}/events.jsonl`, "utf8");
    for (const sensitive of [
      "12345",
      "67890",
      "jordan@example.test",
      "202-555-0182",
    ])
      assert(!logs.includes(sensitive));
  } finally {
    globalThis.fetch = oldFetch;
    await x.close();
  }
});

test("declared invariants and outcomes distinguish contact lookup from savings availability", async () => {
  const x = await setup();
  try {
    const contact = await replayWorkflow(
      artifact(),
      { customer_ref: "11111" },
      x.surface,
    );
    assert.equal(contact.status, "success"); // This member has no savings, but does have contact details.
    await x.surface.page.goto(x.surface.base);
    const savings = await replayWorkflow(
      artifact("savings"),
      { member_id: "11111" },
      x.surface,
    );
    assert.equal(savings.status, "business_outcome");
    assert.equal(savings.code, "NO_SAVINGS_ACCOUNT");
    await x.surface.page.goto(x.surface.base);
    const missing = await replayWorkflow(
      artifact(),
      { customer_ref: "99999" },
      x.surface,
    );
    assert.equal(missing.code, "MEMBER_NOT_FOUND");
    await x.surface.page.goto(x.surface.base + "/member?member=67890");
    const run = new WorkflowRun(task(), { customer_ref: "12345" }, x.surface);
    await assert.rejects(() => run.outputs(), { code: "IDENTITY_MISMATCH" });
    await x.surface.page.goto(x.surface.base + "/member?member=12345");
    await x.surface.page
      .locator("#member-id")
      .evaluate((el) => (el.textContent = "67890"));
    await assert.rejects(() => run.outputs(), { code: "IDENTITY_MISMATCH" });
  } finally {
    await x.close();
  }
});

test("target fallback handles absent labels but never escapes ambiguity; scopes restrict lookup", async () => {
  const x = await setup("legacy");
  try {
    await x.surface.document().goto(x.surface.base + "/members");
    const spec = task();
    // Deliberately missing first label: the trusted fallback identifies the legacy input by attribute.
    spec.elements.lookup_field = {
      candidates: [
        { by: "label", value: "Unprovided label" },
        { by: "css", value: "input[name='member']" },
      ],
    };
    const run = new WorkflowRun(spec, { customer_ref: "12345" }, x.surface);
    assert.equal(await (await run.resolve("lookup_field"))!.count(), 1);
    assert.equal(x.surface.diagnostics.candidate_index, 1);
    await x.surface
      .document()
      .locator("input[name='member']")
      .evaluate((el) => el.after(el.cloneNode(true)));
    spec.elements.lookup_field.candidates.push({
      by: "css",
      value: "input[name='member']:first-of-type",
    });
    await assert.rejects(() => run.resolve("lookup_field"), {
      code: "AMBIGUOUS_TARGET",
    });
    spec.elements.lookup_field.scope = { by: "css", value: "td:first-child" };
    assert.equal(await run.resolve("lookup_field"), undefined);
  } finally {
    await x.close();
  }
});

test("v2 uses the shared control policy and never retries an uncertain click", async () => {
  const x = await setup();
  try {
    await x.surface.page.goto(x.surface.base + "/members");
    const run = new WorkflowRun(task(), { customer_ref: "12345" }, x.surface);
    await run.action({
      action: "fill",
      element: "lookup_field",
      input: "customer_ref",
    });
    await x.surface.page
      .getByRole("button", { name: "Search" })
      .evaluate((el) => el.setAttribute("formmethod", "post"));
    await assert.rejects(
      () => run.action({ action: "click", element: "search" }),
      { code: "POLICY_BLOCKED" },
    );
    await x.surface.page.goto(x.surface.base);
    let dispatches = 0;
    const original = x.surface.performAction.bind(x.surface);
    x.surface.performAction = async (...args) => {
      dispatches++;
      await original(...args);
      throw new (await import("../src/contracts.js")).RunError(
        "POSTCONDITION_TIMEOUT",
      );
    };
    const result = await replayWorkflow(
      artifact(),
      { customer_ref: "12345" },
      x.surface,
    );
    assert.equal(result.code, "POSTCONDITION_TIMEOUT");
    assert.equal(dispatches, 1);
  } finally {
    await x.close();
  }
});

test("policy preflight and input validation precede browser dispatch", async () => {
  const x = await setup();
  try {
    let dispatches = 0;
    x.surface.performAction = async () => {
      dispatches++;
      throw Error("Must not execute");
    };
    const blocked = artifact();
    const last = blocked.steps.at(-1)!;
    if (last.action === "click") last.postcondition.value = "/transfer";
    assert.equal(
      (await replayWorkflow(blocked, { customer_ref: "12345" }, x.surface))
        .code,
      "POLICY_PREFLIGHT_FAILED",
    );
    assert.equal(
      (await replayWorkflow(artifact(), { member_id: "12345" }, x.surface))
        .code,
      "INVALID_INVOCATION",
    );
    assert.equal(dispatches, 0);
  } finally {
    await x.close();
  }
});

test("conflicting business outcomes fail closed and outputs remain typed and unique", async () => {
  const x = await setup();
  try {
    const spec = task();
    spec.outcomes.push({
      when: [{ kind: "path", value: "/results" }],
      code: "SECOND_OUTCOME",
    });
    const run = new WorkflowRun(spec, { customer_ref: "99999" }, x.surface);
    await x.surface.page.goto(x.surface.base + "/results?member=99999");
    await assert.rejects(() => run.guard(), { code: "AMBIGUOUS_OUTCOME" });
    await x.surface.page.goto(x.surface.base + "/account?member=12345");
    const savings = new WorkflowRun(
      task("savings"),
      { member_id: "12345" },
      x.surface,
    );
    await x.surface.page
      .locator("#balance")
      .evaluate((el) => (el.textContent = "unavailable"));
    await assert.rejects(() => savings.outputs(), { code: "INVALID_OUTPUT" });
    await x.surface.page.locator("#balance").evaluate((el) => {
      el.textContent = "0.00";
    });
    assert.equal((await savings.outputs()).balance, "0.00");
    await x.surface.page
      .locator("#balance")
      .evaluate((el) => el.after(el.cloneNode(true)));
    await assert.rejects(() => savings.outputs(), { code: "AMBIGUOUS_TARGET" });
  } finally {
    await x.close();
  }
});

test("v2 auth handoff resumes the same browser and validates identity after restoration", async () => {
  const oldHeadless = process.env.TEST_HEADLESS;
  process.env.TEST_HEADLESS = "1";
  const x = await setup("auth", true);
  try {
    const page = x.surface.page;
    const running = replayWorkflow(
      artifact("savings"),
      { member_id: "12345" },
      x.surface,
    );
    const end = Date.now() + 8000;
    while (!x.session.operatorURL && Date.now() < end)
      await new Promise((r) => setTimeout(r, 20));
    assert(x.session.operatorURL);
    assert.equal(
      (
        await fetch(x.session.operatorURL, {
          method: "POST",
          body: "action=resume",
        })
      ).status,
      409,
    );
    await page.getByRole("button", { name: "Restore demo session" }).click();
    await page.locator("#account-kind").waitFor();
    assert.equal(
      (
        await fetch(x.session.operatorURL, {
          method: "POST",
          body: "action=resume",
        })
      ).status,
      200,
    );
    const result = await running;
    assert.equal(result.status, "success");
    assert.equal(result.assisted, true);
    assert.equal(x.surface.page, page);
  } finally {
    await x.close();
    if (oldHeadless === undefined) delete process.env.TEST_HEADLESS;
    else process.env.TEST_HEADLESS = oldHeadless;
  }
});

test("original artifact normalization preserves bytes, extraction targets, and action order", async () => {
  const { normalizeCapability } = await import("../src/compatibility.js");
  const original = readFileSync("capabilities/savings.json", "utf8");
  const raw = JSON.parse(original);
  const before = JSON.stringify(raw);
  const normalized = Workflow.parse(normalizeCapability(raw));
  assert.equal(JSON.stringify(raw), before);
  assert.equal(readFileSync("capabilities/savings.json", "utf8"), original);
  assert.deepEqual(
    normalized.steps.map((s) => s.action),
    raw.steps.map((s: { action: string }) => s.action),
  );
  for (const [index, step] of normalized.steps.entries())
    assert.deepEqual(normalized.elements[step.element]!.candidates, [
      raw.steps[index].target,
    ]);
  assert.equal(normalized.provenance.run_id, raw.provenance.run_id);
});

test("shared replay preserves final-completion handoff for the original artifact", async () => {
  const previous = process.env.TEST_HEADLESS;
  process.env.TEST_HEADLESS = "1";
  const x = await setup("normal", true);
  try {
    const original = x.surface.performAction.bind(x.surface);
    let clicks = 0;
    x.surface.performAction = async (...args) => {
      const result = await original(...args);
      if (args[0].action === "click") clicks++;
      if (new URL(x.surface.document().url()).pathname === "/account")
        await x.surface.page
          .locator("#account-kind")
          .evaluate((el) => el.remove());
      return result;
    };
    const pending = replayWorkflow(
      JSON.parse(readFileSync("capabilities/savings.json", "utf8")),
      { member_id: "12345" },
      x.surface,
    );
    const until = Date.now() + 8000;
    while (!x.session.operatorURL && Date.now() < until)
      await new Promise((r) => setTimeout(r, 20));
    assert(x.session.operatorURL);
    assert.equal(
      (
        await fetch(x.session.operatorURL, {
          method: "POST",
          body: "action=resume",
        })
      ).status,
      409,
    );
    await x.surface.page.evaluate(() => {
      const el = document.createElement("dd");
      el.id = "account-kind";
      el.textContent = "savings";
      document.body.append(el);
    });
    assert.equal(
      (
        await fetch(x.session.operatorURL, {
          method: "POST",
          body: "action=resume",
        })
      ).status,
      200,
    );
    const result = await pending;
    assert.equal(result.status, "success");
    assert.equal(result.assisted, true);
    assert.equal(clicks, 4);
  } finally {
    await x.close();
    if (previous === undefined) delete process.env.TEST_HEADLESS;
    else process.env.TEST_HEADLESS = previous;
  }
});

test("shared discovery hands repeated invalid decisions to a human and validates resume", async () => {
  const previous = process.env.TEST_HEADLESS;
  process.env.TEST_HEADLESS = "1";
  const x = await setup("normal", true);
  try {
    let requests = 0;
    const pending = discoverWorkflow(
      task(),
      { customer_ref: "12345" },
      x.surface,
      async () => {
        if (++requests > 3) throw Error("Stop after verified handoff");
        return { action: "fill", element: "lookup_field", input: "undeclared" };
      },
    ).catch((error: Error) => error);
    const until = Date.now() + 8000;
    while (!x.session.operatorURL && Date.now() < until)
      await new Promise((r) => setTimeout(r, 20));
    assert(x.session.operatorURL);
    assert.equal(
      (
        await fetch(x.session.operatorURL, {
          method: "POST",
          body: "action=resume",
        })
      ).status,
      409,
    );
    await x.surface.page
      .getByRole("link", { name: "Members", exact: true })
      .click();
    assert.equal(
      (
        await fetch(x.session.operatorURL, {
          method: "POST",
          body: "action=resume",
        })
      ).status,
      200,
    );
    assert.match(String(await pending), /Stop after verified handoff/);
    assert.equal(x.session.assisted, true);
    assert(
      x.events.history.some(
        (e) => e.type === "intervention" && e.code === "DISCOVERY_STUCK",
      ),
    );
  } finally {
    await x.close();
    if (previous === undefined) delete process.env.TEST_HEADLESS;
    else process.env.TEST_HEADLESS = previous;
  }
});
