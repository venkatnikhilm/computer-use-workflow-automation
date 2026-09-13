import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
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
      () => surface.act(fixture.steps[0] as never, { member_id: "12345" }),
      /CONTROL_NOT_OWNED/,
    );
    session.owner = "automation";
    await replay(fixture, { member_id: "12345" }, surface);
    await assert.rejects(
      () =>
        surface.act(
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
writeFileSync(
  "capabilities/development.json",
  JSON.stringify(fixture, null, 2),
);

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
        surface.act(
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
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.GEMINI_API_KEY;
  const oldModel = process.env.GEMINI_MODEL;
  let calls = 0;
  process.env.GEMINI_API_KEY = "mock-only";
  process.env.GEMINI_MODEL = "mock-only";
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
                      ? { action: fixture.steps[calls++], finish: false }
                      : { action: null, finish: true },
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
    if (oldKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = oldKey;
    if (oldModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = oldModel;
    await surface.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
