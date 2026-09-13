import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium, type Page } from "playwright";
import { startDemo } from "../demo/server.js";
import { demoCredentials } from "../demo/auth.js";
import { Surface } from "../src/browser.js";
import { Session } from "../src/session.js";
import { Events } from "../src/events.js";
import { replay } from "../src/replay.js";

async function credentials(page: Page) {
  await page
    .getByLabel("Username", { exact: true })
    .fill(demoCredentials.username);
  await page
    .getByLabel("Password", { exact: true })
    .fill(demoCredentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("heading", { name: "Verify your identity" }).waitFor();
}
async function verify(page: Page) {
  await page.getByLabel("Verification code").fill(demoCredentials.code);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await page.locator("[data-auth-required]").waitFor({ state: "detached" });
}
async function waiting(session: Session, previous = "") {
  const end = Date.now() + 10000;
  while (
    session.owner !== "human" ||
    !session.operatorURL ||
    session.operatorURL === previous
  ) {
    if (Date.now() > end) throw new Error("Handoff did not arrive");
    await new Promise((r) => setTimeout(r, 10));
  }
  return session.operatorURL;
}
for (const scenario of ["login", "login-expiry"]) {
  test(`${scenario}: real browser replay pauses for credentials and code, preserving the workflow`, async () => {
    process.env.TEST_HEADLESS = "1";
    const server = await startDemo(0, scenario);
    const address = server.address();
    assert(address && typeof address !== "string");
    const events = new Events("evidence/development");
    const session = new Session(events, true, 20000);
    const surface = new Surface(
      `http://127.0.0.1:${address.port}`,
      events,
      session,
    );
    let resultPromise: ReturnType<typeof replay> | undefined;
    try {
      await surface.open();
      const artifact = JSON.parse(
        readFileSync("capabilities/savings.json", "utf8"),
      );
      resultPromise = replay(artifact, { member_id: "12345" }, surface);
      let operator = await waiting(session);
      const premature = await fetch(operator, {
        method: "POST",
        body: "action=resume",
      });
      assert.equal(premature.status, 409);
      assert.match(await premature.text(), /Complete sign-in/);
      await surface.page
        .getByLabel("Username", { exact: true })
        .fill(demoCredentials.username);
      await surface.page
        .getByLabel("Password", { exact: true })
        .fill("wrong-password-secret");
      await surface.page
        .getByRole("button", { name: "Sign in", exact: true })
        .click();
      await surface.page
        .getByRole("alert")
        .filter({ hasText: "incorrect" })
        .waitFor();
      await credentials(surface.page);
      assert.equal(
        (await fetch(operator, { method: "POST", body: "action=resume" }))
          .status,
        409,
      );
      await surface.page.getByLabel("Verification code").fill("000000");
      await surface.page
        .getByRole("button", { name: "Verify and continue" })
        .click();
      await surface.page
        .getByRole("alert")
        .filter({ hasText: "Incorrect verification" })
        .waitFor();
      await verify(surface.page);
      assert.equal(
        (await fetch(operator, { method: "POST", body: "action=resume" }))
          .status,
        200,
      );
      if (scenario === "login-expiry") {
        operator = await waiting(session, operator);
        await credentials(surface.page);
        await verify(surface.page);
        assert.equal(new URL(surface.page.url()).pathname, "/account");
        assert.equal(
          (await fetch(operator, { method: "POST", body: "action=resume" }))
            .status,
          200,
        );
      }
      const result = await resultPromise;
      assert.equal(result.status, "success");
      if (result.status === "success") {
        assert.equal(result.assisted, true);
        assert.equal(result.outputs.balance, "100.00");
      }
      const logs = readFileSync(`${events.directory}/events.jsonl`, "utf8");
      for (const secret of [
        ...Object.values(demoCredentials),
        "wrong-password-secret",
        "000000",
      ])
        assert(!logs.includes(secret));
      assert(logs.includes('"model_calls":0'));
    } finally {
      if (session.owner === "human")
        await fetch(session.operatorURL, {
          method: "POST",
          body: "action=cancel",
        }).catch(() => {});
      await resultPromise;
      await surface.close();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
}
test("expired and exhausted verification challenges cannot authenticate; a new challenge can", async () => {
  let now = Date.now();
  const server = await startDemo(0, "login", () => now);
  const address = server.address();
  assert(address && typeof address !== "string");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/account?member=12345`);
    await credentials(page);
    now += 120001;
    await page.getByLabel("Verification code").fill(demoCredentials.code);
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await page.getByRole("alert").filter({ hasText: "expired" }).waitFor();
    await page.getByRole("button", { name: "Start sign-in again" }).click();
    await credentials(page);
    for (let i = 0; i < 3; i++) {
      await page.getByLabel("Verification code").fill("000000");
      await page.getByRole("button", { name: "Verify and continue" }).click();
    }
    await page.getByLabel("Verification code").fill(demoCredentials.code);
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await page.getByRole("alert").filter({ hasText: "Too many" }).waitFor();
    await page.getByRole("button", { name: "Start sign-in again" }).click();
    await credentials(page);
    await verify(page);
    assert.equal(await page.locator("#balance").textContent(), "100.00");
    // Independent browser context and a forged legacy cookie cannot bypass the gate.
    const other = await browser.newContext();
    await other.addCookies([
      {
        name: "demo-auth",
        value: "1",
        url: `http://127.0.0.1:${address.port}`,
      },
    ]);
    const anonymous = await other.newPage();
    await anonymous.goto(
      `http://127.0.0.1:${address.port}/account?member=12345`,
    );
    assert.equal(await anonymous.locator("#balance").count(), 0);
    assert.equal(await anonymous.locator("[data-auth-required]").count(), 1);
  } finally {
    await browser.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
