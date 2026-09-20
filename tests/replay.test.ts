import { testAction, testRun } from "./browser-helpers.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { startDemo } from "../demo/server.js";
import { Capability, Input } from "../src/contracts.js";
import { Surface } from "../src/browser.js";
import { Session } from "../src/session.js";
import { Events } from "../src/events.js";
import { replay } from "../src/replay.js";
export const fixture = {
  schema_version: 1,
  id: "get_savings_balance",
  version: 1,
  application: "bank-demo-v1",
  inputs: { member_id: "string:5-digits" },
  outputs: { balance: "decimal-string", currency: "ISO-4217" },
  steps: [
    { action: "click", target: { by: "role", role: "link", value: "Members" } },
    {
      action: "fill",
      target: { by: "label", value: "Member ID" },
      input: "member_id",
    },
    {
      action: "click",
      target: { by: "role", role: "button", value: "Search" },
    },
    {
      action: "click",
      target: { by: "role", role: "link", value: "Open member" },
    },
    { action: "click", target: { by: "role", role: "link", value: "Savings" } },
  ],
  completion: "member-and-savings-identity",
  handler_profile: "bank-conditions-v1",
  provenance: { kind: "development-fixture", run_id: randomUUID() },
};
fixture.steps = fixture.steps.map((step, index) => ({
  ...step,
  postcondition:
    step.action === "fill"
      ? { kind: "field_equals_input", input: "member_id" }
      : {
          kind: "path",
          value: ["/members", "", "/results", "/member", "/account"][index],
        },
}));
test("schema rejects arbitrary actions, literal inputs and malformed IDs", () => {
  Capability.parse(fixture);
  assert.throws(() => Input.parse({ member_id: 12345 }));
  assert.throws(() =>
    Capability.parse({ ...fixture, steps: [{ action: "execute", code: "x" }] }),
  );
  assert.throws(() =>
    Capability.parse({
      ...fixture,
      steps: fixture.steps.map((s) =>
        s.action === "fill" ? { ...s, input: undefined } : s,
      ),
    }),
  );
});
for (const [scenario, id, status, code] of [
  ["normal", "67890", "success", undefined],
  ["normal", "99999", "business_outcome", "MEMBER_NOT_FOUND"],
  ["normal", "11111", "business_outcome", "NO_SAVINGS_ACCOUNT"],
  ["normal", "22222", "business_outcome", "AMBIGUOUS_ACCOUNT"],
  ["slow", "12345", "success", undefined],
  ["unknown", "12345", "failure", "COMPLETION_NOT_MET"],
  ["auth", "12345", "failure", "INTERVENTION_REQUIRED"],
] as const) {
  test(`${scenario}: ${id}`, async () => {
    const server = await startDemo(0, scenario);
    const address = server.address();
    assert(address && typeof address !== "string");
    const events = new Events("evidence/development");
    const surface = new Surface(
      `http://127.0.0.1:${address.port}`,
      events,
      new Session(events, false),
    );
    try {
      await surface.open();
      const result = await replay(fixture, { member_id: id }, surface);
      assert.equal(result.status, status);
      if (code) assert.equal("code" in result && result.code, code);
      if (result.status === "success")
        assert.deepEqual(result.outputs, {
          balance: id === "67890" ? "2450.75" : "100.00",
          currency: "USD",
        });
      const logs = readFileSync(`${events.directory}/events.jsonl`, "utf8");
      assert(!logs.includes(id));
      assert(!logs.includes("2450.75"));
      assert(logs.includes('"model_calls":0'));
    } finally {
      await surface.close();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
}
test("policy and ownership stop browser actions", async () => {
  const server = await startDemo(0);
  const a = server.address();
  assert(a && typeof a !== "string");
  const events = new Events("evidence/development");
  const session = new Session(events, false);
  const surface = new Surface(`http://127.0.0.1:${a.port}`, events, session);
  try {
    await surface.open();
    assert(!surface.allowed("https://example.com"));
    session.owner = "human";
    await assert.rejects(
      () =>
        testAction(surface, fixture.steps[0] as never, { member_id: "12345" }),
      /CONTROL_NOT_OWNED/,
    );
    session.owner = "automation";
    await replay(fixture, { member_id: "12345" }, surface);
    await assert.rejects(
      () =>
        testAction(
          surface,
          {
            action: "click",
            target: { by: "role", role: "button", value: "Transfer funds" },
          },
          { member_id: "12345" },
        ),
      /POLICY_BLOCKED/,
    );
  } finally {
    await surface.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
test("replay source has no discovery or provider import", () => {
  const text = readFileSync("src/replay.ts", "utf8");
  assert(!/from.*(?:discovery|google|gemini|openai)/.test(text));
});

test("same-session handoff validates resume and captures operator actions (simulated operator)", async () => {
  process.env.TEST_HEADLESS = "1";
  const server = await startDemo(0, "auth");
  const a = server.address();
  assert(a && typeof a !== "string");
  const events = new Events("evidence/development");
  const session = new Session(events, true);
  const surface = new Surface(`http://127.0.0.1:${a.port}`, events, session);
  try {
    await surface.open();
    const page = surface.page;
    const running = replay(fixture, { member_id: "12345" }, surface);
    const deadline = Date.now() + 10000;
    while (!session.operatorURL && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 20));
    assert(session.operatorURL);
    assert.equal(session.owner, "human");
    const premature = await fetch(session.operatorURL, {
      method: "POST",
      body: "action=resume",
    });
    assert.equal(premature.status, 409);
    await assert.rejects(
      () =>
        testAction(
          surface,
          {
            action: "click",
            target: {
              by: "role",
              role: "button",
              value: "Restore demo session",
            },
          },
          { member_id: "12345" },
        ),
      /CONTROL_NOT_OWNED/,
    );
    // Test harness plays the human; production operator uses this same live window.
    await page.getByRole("button", { name: "Restore demo session" }).click();
    await page.locator("#account-kind").waitFor();
    const resumed = await fetch(session.operatorURL, {
      method: "POST",
      body: "action=resume",
    });
    assert.equal(resumed.status, 200);
    const result = await running;
    assert.equal(result.status, "success");
    assert.equal("assisted" in result && result.assisted, true);
    assert.equal(surface.page, page);
    assert(
      readFileSync(`${events.directory}/events.jsonl`, "utf8").includes(
        "human_action",
      ),
    );
  } finally {
    await surface.close();
    await new Promise<void>((r) => server.close(() => r()));
    delete process.env.TEST_HEADLESS;
  }
});

test("discovery wiring with mocked provider generates a parameterized artifact (not live evidence)", async () => {
  const { discover } = await import("../src/discovery.js");
  const server = await startDemo(0);
  const a = server.address();
  assert(a && typeof a !== "string");
  const events = new Events("evidence/development");
  const surface = new Surface(
    `http://127.0.0.1:${a.port}`,
    events,
    new Session(events, false),
  );
  const oldInterval = process.env.MODEL_MIN_INTERVAL_MS;
  process.env.MODEL_MIN_INTERVAL_MS = "0";
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.GEMINI_API_KEY;
  const oldModel = process.env.GEMINI_MODEL;
  let calls = 0;
  process.env.GEMINI_API_KEY = "mock-only";
  process.env.GEMINI_MODEL = "gemini-mock-only";
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify(
                    calls < fixture.steps.length
                      ? {
                          action: fixture.steps[calls].action,
                          element: [
                            "directory",
                            "lookup_field",
                            "search",
                            "open_record",
                            "savings_link",
                          ][calls],
                          input:
                            fixture.steps[calls++].action === "fill"
                              ? "member_id"
                              : null,
                        }
                      : { action: "finish" },
                  ),
                },
              ],
            },
          },
        ],
      }),
      { status: 200 },
    );
  try {
    await surface.open();
    const artifact = await discover(
      "Read savings balance",
      { member_id: "12345" },
      surface,
    );
    assert.equal(artifact.steps.length, 5);
    assert(!JSON.stringify(artifact).includes("12345"));
    // Override provenance: mocked provider results must never masquerade as real discovery evidence.
    artifact.provenance.kind = "development-fixture";
    await surface.page.goto(surface.base);
    const result = await replay(artifact, { member_id: "67890" }, surface);
    assert.equal(result.status, "success");
  } finally {
    globalThis.fetch = oldFetch;
    if (oldInterval === undefined) delete process.env.MODEL_MIN_INTERVAL_MS;
    else process.env.MODEL_MIN_INTERVAL_MS = oldInterval;
    if (oldKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = oldKey;
    if (oldModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = oldModel;
    await surface.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("artifact rejects incomplete targets and action/checkpoint mismatches", () => {
  const base = Capability.parse(fixture);
  for (const target of [
    { by: "role", value: "Members" },
    { by: "label", value: " " },
    { by: "css", value: "a", role: "link" },
  ]) {
    assert.throws(() =>
      Capability.parse({
        ...base,
        steps: [{ ...base.steps[0], target }, ...base.steps.slice(1)],
      }),
    );
  }
  for (const [index, postcondition] of [
    [0, { kind: "field_equals_input", input: "member_id" }],
    [1, { kind: "path", value: "/members" }],
  ] as const) {
    assert.throws(() =>
      Capability.parse({
        ...base,
        steps: base.steps.map((step, i) =>
          i === index ? { ...step, postcondition } : step,
        ),
      }),
    );
  }
});

test("policy preflight rejects a later forbidden step before performing any actions", async () => {
  const events = new Events("evidence/development");
  const surface = new Surface(
    "http://127.0.0.1:4173",
    events,
    new Session(events, false),
    {
      routes: ["/", "/members"],
      actions: ["click", "fill"],
      link_labels: ["Members"],
      fill_names: ["member"],
      search_form: "/results",
    },
  );
  let actions = 0;
  surface.performAction = async () => {
    actions++;
    throw Error("Must not dispatch");
  };
  const result = await replay(fixture, { member_id: "12345" }, surface);
  assert.equal(result.code, "POLICY_PREFLIGHT_FAILED");
  assert.equal(actions, 0);
  const malformed = await replay(
    { ...fixture, schema_version: 99 },
    { member_id: "12345" },
    surface,
  );
  assert.equal(malformed.code, "INVALID_INVOCATION");
  assert.equal(actions, 0);
});

test("business outcomes are scoped to the requested member and correct screen", async () => {
  const server = await startDemo(0);
  const a = server.address();
  assert(a && typeof a !== "string");
  const events = new Events("evidence/development");
  const surface = new Surface(
    `http://127.0.0.1:${a.port}`,
    events,
    new Session(events, false),
  );
  try {
    await surface.open();
    await surface.page.evaluate(() => {
      const p = document.createElement("p");
      p.setAttribute("role", "status");
      p.textContent = "Member not found";
      document.body.append(p);
    });
    await testRun(surface, { member_id: "12345" }).guard(); // Unrelated homepage status is not a search outcome.
    await surface.page.goto(surface.base + "/member?member=11111");
    await assert.rejects(
      () => testRun(surface, { member_id: "12345" }).guard(),
      /IDENTITY_MISMATCH/,
    );
    await assert.rejects(
      () => testRun(surface, { member_id: "11111" }).guard(),
      /NO_SAVINGS_ACCOUNT/,
    );
    await surface.page.goto(surface.base + "/member?member=12345");
    await surface.page
      .locator("#member-id")
      .evaluate((el) => (el.textContent = "67890"));
    await assert.rejects(
      () => testRun(surface, { member_id: "12345" }).guard(),
      /IDENTITY_MISMATCH/,
    );
  } finally {
    await surface.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("output extraction follows artifact descriptors and refuses ambiguous output targets", async () => {
  const server = await startDemo(0);
  const a = server.address();
  assert(a && typeof a !== "string");
  const events = new Events("evidence/development");
  const surface = new Surface(
    `http://127.0.0.1:${a.port}`,
    events,
    new Session(events, false),
  );
  try {
    await surface.open();
    await replay(fixture, { member_id: "12345" }, surface);
    await surface.page
      .locator("#balance")
      .evaluate((el) => (el.id = "available-savings-balance"));
    const extraction = {
      ...Capability.parse(fixture).extraction,
      balance: { by: "css" as const, value: "#available-savings-balance" },
    };
    assert.deepEqual(
      await testRun(surface, { member_id: "12345" }, extraction).outputs(),
      { balance: "100.00", currency: "USD" },
    );
    await surface.page
      .locator("#member-id")
      .evaluate((el) => el.after(el.cloneNode(true)));
    await assert.rejects(
      () => testRun(surface, { member_id: "12345" }, extraction).outputs(),
      /AMBIGUOUS_TARGET/,
    );
    await surface.page
      .locator("#member-id")
      .last()
      .evaluate((el) => el.remove());
    await surface.page
      .locator("#available-savings-balance")
      .evaluate((el) => el.after(el.cloneNode(true)));
    await assert.rejects(
      () => testRun(surface, { member_id: "12345" }, extraction).outputs(),
      /AMBIGUOUS_TARGET/,
    );
  } finally {
    await surface.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
