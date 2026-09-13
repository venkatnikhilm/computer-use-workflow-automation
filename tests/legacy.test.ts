import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startDemo } from "../demo/server.js";
import { TenantProfile } from "../src/profile.js";
import { defaultPolicy } from "../src/policy.js";
import { Events } from "../src/events.js";
import { Session } from "../src/session.js";
import { Surface } from "../src/browser.js";
import { replay } from "../src/replay.js";
const artifact = JSON.parse(readFileSync("capabilities/savings.json", "utf8"));
const profile = TenantProfile.parse(
  JSON.parse(readFileSync("profiles/legacy.json", "utf8")),
);
for (const [scenario, member, expected] of [
  ["legacy", "67890", "success"],
  ["legacy", "99999", "MEMBER_NOT_FOUND"],
  ["legacy-ambiguous", "12345", "AMBIGUOUS_TARGET"],
]) {
  test(`${scenario}: ${expected}`, async () => {
    const server = await startDemo(0, scenario);
    const a = server.address();
    assert(a && typeof a !== "string");
    const events = new Events("evidence/development");
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
      if (expected === "success") {
        assert.equal(result.status, "success");
        assert.equal(result.outputs?.balance, "2450.75");
        assert.equal(new URL(surface.page.url()).pathname, "/");
        assert.equal(new URL(surface.document().url()).pathname, "/account");
      } else {
        assert.equal("code" in result && result.code, expected);
        const snapshot = JSON.parse(
          readFileSync(`${events.directory}/failure.json`, "utf8"),
        );
        assert.equal(snapshot.code, expected);
        if (expected === "AMBIGUOUS_TARGET") {
          assert.equal(snapshot.diagnostics.matches, 2);
          assert.equal(snapshot.diagnostics.phase, "resolve_target");
        }
      }
      const logs = readFileSync(`${events.directory}/events.jsonl`, "utf8");
      assert(!logs.includes(member));
      assert(!logs.includes("2450.75"));
    } finally {
      await surface.close();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
}
test("frame resolution rejects duplicate named frames rather than choosing the first", async () => {
  const server = await startDemo(0, "legacy");
  const a = server.address();
  assert(a && typeof a !== "string");
  const events = new Events("evidence/development");
  const surface = new Surface(
    `http://127.0.0.1:${a.port}`,
    events,
    new Session(events, false),
    defaultPolicy,
    profile,
  );
  try {
    await surface.open();
    await surface.page.evaluate(() => {
      const f = document.createElement("iframe");
      f.name = "workspace";
      f.src = "/?embedded=1";
      document.body.append(f);
    });
    await surface.page.waitForFunction(
      () => document.querySelectorAll("iframe").length === 2,
    );
    assert.throws(() => surface.document(), { code: "AMBIGUOUS_FRAME" });
  } finally {
    await surface.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
