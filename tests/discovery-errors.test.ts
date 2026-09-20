import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startDemo } from "../demo/server.js";
import { Surface } from "../src/browser.js";
import { Events } from "../src/events.js";
import { Session } from "../src/session.js";
import { discoverWorkflow } from "../src/workflow-discovery.js";

async function setup(respond: (body: string) => Response, interactive = false) {
  const originalFetch = globalThis.fetch;
  const config = {
    GEMINI_API_KEY: "mock-only",
    GEMINI_MODEL: "gemini-mock-only",
    MODEL_MIN_INTERVAL_MS: "0",
    MODEL_MAX_CALLS: "6",
    MODEL_MAX_RETRIES: "0",
    TEST_HEADLESS: "1",
  };
  const previous = Object.fromEntries(
    Object.keys(config).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, config);
  const server = await startDemo(0);
  const address = server.address();
  assert(address && typeof address !== "string");
  const events = new Events("evidence/development");
  const session = new Session(events, interactive, 10000);
  const surface = new Surface(
    `http://127.0.0.1:${address.port}`,
    events,
    session,
  );
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith("https://generativelanguage.googleapis.com/")) {
      calls++;
      return respond(String(options?.body));
    }
    return originalFetch(url, options);
  };
  await surface.open();
  return {
    surface,
    events,
    session,
    calls: () => calls,
    run: () =>
      discoverWorkflow(
        JSON.parse(readFileSync("tasks/member-contact.json", "utf8")),
        { customer_ref: "12345" },
        surface,
      ),
    close: async () => {
      globalThis.fetch = originalFetch;
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await surface.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
function answer(text: string) {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
    { status: 200 },
  );
}

test("malformed model JSON is rejected, fed back, and recovery records only verified actions", async () => {
  const decisions = [
    { action: "click", element: "directory" },
    { action: "fill", element: "lookup_field", input: "customer_ref" },
    { action: "click", element: "search" },
    { action: "click", element: "open_record" },
  ];
  let request = 0;
  const x = await setup((body) => {
    if (request++ === 0) return answer("sensitive-invalid-response{");
    if (request === 2) assert(body.includes("MODEL_JSON_INVALID"));
    return answer(JSON.stringify(decisions.shift()));
  });
  try {
    const artifact = await x.run();
    // The real provider path is mocked; do not persist this as live discovery evidence.
    artifact.provenance.kind = "development-fixture";
    assert.equal(artifact.steps.length, 4);
    assert.equal(x.calls(), 5);
    const rejected = x.events.history.filter(
      (e) => e.type === "decision_rejected",
    );
    assert.deepEqual(
      rejected.map((e) => e.code),
      ["MODEL_JSON_INVALID"],
    );
    assert(
      !readFileSync(`${x.events.directory}/events.jsonl`, "utf8").includes(
        "sensitive-invalid-response",
      ),
    );
  } finally {
    await x.close();
  }
});

for (const envelope of [false, true]) {
  test(`repeated malformed ${envelope ? "HTTP envelope" : "model text"} stops after three rejected decisions unattended`, async () => {
    const x = await setup(() =>
      envelope ? new Response("not-json", { status: 200 }) : answer("not-json"),
    );
    try {
      await assert.rejects(x.run(), { code: "DISCOVERY_STUCK" });
      assert.equal(x.calls(), 3);
      assert.equal(
        x.events.history.filter(
          (e) =>
            e.type === "decision_rejected" && e.code === "MODEL_JSON_INVALID",
        ).length,
        3,
      );
      assert(!x.events.history.some((e) => e.type === "action_verified"));
    } finally {
      await x.close();
    }
  });
}

test("repeated malformed JSON routes to human intervention when interactive", async () => {
  const x = await setup(() => answer("not-json"), true);
  try {
    const pending = x.run().catch((error) => error);
    const until = Date.now() + 8000;
    while (!x.session.operatorURL && Date.now() < until)
      await new Promise((r) => setTimeout(r, 20));
    assert(x.session.operatorURL);
    assert.equal(x.session.owner, "human");
    assert(
      x.events.history.some(
        (e) => e.type === "intervention" && e.code === "DISCOVERY_STUCK",
      ),
    );
    assert.equal(x.calls(), 3);
    await fetch(x.session.operatorURL, {
      method: "POST",
      body: "action=cancel",
    });
    assert.equal((await pending).code, "CANCELLED");
  } finally {
    await x.close();
  }
});

test("provider rate limits still stop immediately rather than becoming invalid-decision retries", async () => {
  const x = await setup(() => new Response("{}", { status: 429 }));
  try {
    await assert.rejects(x.run(), { code: "MODEL_RATE_LIMITED" });
    assert.equal(x.calls(), 1);
    assert(!x.events.history.some((e) => e.type === "decision_rejected"));
  } finally {
    await x.close();
  }
});
