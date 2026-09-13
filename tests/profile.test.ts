import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TenantProfile } from "../src/profile.js";
import { defaultPolicy } from "../src/policy.js";
import { startDemo } from "../demo/server.js";
import { Events } from "../src/events.js";
import { Surface } from "../src/browser.js";
import { Session } from "../src/session.js";
import { replay } from "../src/replay.js";
const summit = TenantProfile.parse(
  JSON.parse(readFileSync("profiles/summit.json", "utf8")),
);
const artifact = JSON.parse(readFileSync("capabilities/savings.json", "utf8"));
test("profiles cannot override steps, policy, destinations or supported versions", () => {
  for (const addition of [
    { steps: [] },
    { policy: defaultPolicy },
    { layout_version: "2" },
    { base_url: "https://example.com/" },
  ])
    assert.equal(
      TenantProfile.safeParse({ ...summit, ...addition }).success,
      false,
    );
});
for (const [member, expected] of [
  ["67890", "success"],
  ["99999", "MEMBER_NOT_FOUND"],
  ["11111", "NO_SAVINGS_ACCOUNT"],
  ["22222", "AMBIGUOUS_ACCOUNT"],
]) {
  test(`Summit reuses saved artifact: ${expected}`, async () => {
    const server = await startDemo(0, "normal", Date.now, "summit");
    const a = server.address();
    assert(a && typeof a !== "string");
    const events = new Events("evidence/development");
    const surface = new Surface(
      `http://127.0.0.1:${a.port}`,
      events,
      new Session(events, false),
      defaultPolicy,
      summit,
    );
    try {
      await surface.open();
      const result = await replay(artifact, { member_id: member }, surface);
      if (expected === "success") {
        assert.equal(result.status, "success");
        if (result.status === "success")
          assert.equal(result.outputs?.balance, "2450.75");
        assert.equal(await surface.page.locator("table").count(), 1);
        assert.equal(await surface.page.locator("#balance").count(), 0);
      } else assert.equal("code" in result && result.code, expected);
    } finally {
      await surface.close();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
}
for (const [tenant, version, code] of [
  ["harbor", "1", "TENANT_MISMATCH"],
  ["summit", "2", "UNSUPPORTED_APP_VERSION"],
]) {
  test(`profile preflight: ${code}`, async () => {
    const server = await startDemo(0, "normal", Date.now, tenant, version);
    const a = server.address();
    assert(a && typeof a !== "string");
    const events = new Events("evidence/development");
    const surface = new Surface(
      `http://127.0.0.1:${a.port}`,
      events,
      new Session(events, false),
      defaultPolicy,
      summit,
    );
    try {
      await assert.rejects(surface.open(), { code });
    } finally {
      await surface.close();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
}
test("tenant translation cannot override deployment action policy", async () => {
  const server = await startDemo(0, "normal", Date.now, "summit");
  const a = server.address();
  assert(a && typeof a !== "string");
  const events = new Events("evidence/development");
  const surface = new Surface(
    `http://127.0.0.1:${a.port}`,
    events,
    new Session(events, false),
    { ...defaultPolicy, actions: ["fill"] },
    summit,
  );
  try {
    await surface.open();
    const result = await replay(artifact, { member_id: "12345" }, surface);
    assert.equal("code" in result && result.code, "POLICY_PREFLIGHT_FAILED");
    assert.equal(new URL(surface.page.url()).pathname, "/");
  } finally {
    await surface.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
