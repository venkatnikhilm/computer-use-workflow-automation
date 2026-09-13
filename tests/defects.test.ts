import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startDemo } from "../demo/server.js";
import { Surface } from "../src/browser.js";
import { Session } from "../src/session.js";
import { Events } from "../src/events.js";
import { TenantProfile, harborProfile } from "../src/profile.js";
import { defaultPolicy } from "../src/policy.js";
async function setup(legacy = false) {
  const server = await startDemo(0, legacy ? "legacy" : "normal");
  const a = server.address();
  assert(a && typeof a !== "string");
  const events = new Events("evidence/development");
  const session = new Session(events, false);
  const profile = legacy
    ? TenantProfile.parse(
        JSON.parse(readFileSync("profiles/legacy.json", "utf8")),
      )
    : harborProfile;
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
    session,
    close: async () => {
      await surface.close();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
test("read-only Search rejects a button overriding the form to POST", async () => {
  const x = await setup();
  try {
    await x.surface.page.goto(x.surface.base + "/members");
    await x.surface.page.getByLabel("Member ID").fill("12345");
    await x.surface.page
      .getByRole("button", { name: "Search" })
      .evaluate((el) => el.setAttribute("formmethod", "post"));
    await assert.rejects(
      x.surface.act(
        {
          action: "click",
          target: { by: "role", role: "button", value: "Search" },
        },
        { member_id: "12345" },
      ),
      { code: "POLICY_BLOCKED" },
    );
  } finally {
    await x.close();
  }
});
test("member-name matching alone cannot authorize filling a password input", async () => {
  const x = await setup();
  try {
    await x.surface.page.goto(x.surface.base + "/members");
    await x.surface.page
      .getByLabel("Member ID")
      .evaluate((el) => el.setAttribute("type", "password"));
    await assert.rejects(
      x.surface.act(
        {
          action: "fill",
          target: { by: "label", value: "Member ID" },
          input: "member_id",
        },
        { member_id: "12345" },
      ),
      { code: "POLICY_BLOCKED" },
    );
  } finally {
    await x.close();
  }
});
test("operator guidance reads verification state inside the configured iframe", async () => {
  const x = await setup(true);
  try {
    await x.surface
      .document()
      .locator("body")
      .evaluate((el) => {
        el.innerHTML =
          "<section data-auth-required><h1>Verify your identity</h1></section>";
      });
    assert.match(await x.session.guidance(), /^Complete verification/);
  } finally {
    await x.close();
  }
});
test("failed resume validation returns a failed HTTP response", async () => {
  const session = new Session(new Events("evidence/development"), true, 2000);
  const result = session
    .handoff("AUTH_REQUIRED", async () => {
      throw Error("lost");
    })
    .catch((e) => e);
  try {
    while (!session.operatorURL) await new Promise((r) => setTimeout(r, 5));
    const response = await fetch(session.operatorURL, {
      method: "POST",
      body: "action=resume",
    });
    assert.equal((await result).code, "SESSION_LOST");
    assert.equal(response.status, 409);
  } finally {
    session.server?.close();
  }
});
