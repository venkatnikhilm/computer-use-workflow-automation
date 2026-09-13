import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { Dashboard } from "../src/dashboard.js";
import { Session } from "../src/session.js";
import { Events } from "../src/events.js";
test("dashboard renders progress, rejects premature resume and shows terminal result without output values", async () => {
  const events = new Events(mkdtempSync(join(tmpdir(), "dashboard-")));
  const session = new Session(events, true, 10000);
  session.stepLabels = ["Open member directory"];
  session.guidance = async () =>
    "Complete verification in the banking window, then return here and click Resume.";
  const dashboard = new Dashboard(events, session, "summit");
  const browser = await chromium.launch();
  let ready = false;
  const pending = session.handoff("AUTH_REQUIRED", async () => ready);
  try {
    while (!session.operatorURL) await new Promise((r) => setTimeout(r, 5));
    const url = await dashboard.start();
    const page = await browser.newPage();
    await page.goto(url);
    await page.getByText("Summit Community Bank", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await page
      .getByText("Not ready. Follow the instructions above and try again.", {
        exact: true,
      })
      .waitFor();
    assert.equal(session.owner, "human");
    ready = true;
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await pending;
    events.emit("step_completed", { step: 0, action: "click" });
    events.emit("success", { assisted: true, model_calls: 0 });
    dashboard.finish();
    await page.getByText("success · Human assisted", { exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Resume", exact: true })
        .isDisabled(),
      true,
    );
    const state = await (await fetch(url + "/status")).text();
    assert.equal(Object.hasOwn(JSON.parse(state), "outputs"), false);
    assert(!state.includes(session.operatorURL));
    assert(!state.includes("482916"));
    assert.equal(
      (await fetch(url, { method: "POST", body: "action=resume" })).status,
      409,
    );
    assert.equal((await fetch(new URL("/wrong-token", url))).status, 404);
  } finally {
    dashboard.close();
    session.server?.close();
    await browser.close();
  }
});
test("dashboard cancellation uses the same handoff path", async () => {
  const events = new Events(mkdtempSync(join(tmpdir(), "dashboard-cancel-")));
  const session = new Session(events, true, 10000);
  const dashboard = new Dashboard(events, session, "harbor");
  const pending = session
    .handoff("AUTH_REQUIRED", async () => false)
    .catch((e) => e);
  try {
    while (!session.operatorURL) await new Promise((r) => setTimeout(r, 5));
    const url = await dashboard.start();
    assert.equal(
      (await fetch(url, { method: "POST", body: "action=cancel" })).status,
      200,
    );
    assert.equal((await pending).code, "CANCELLED");
    assert.equal(session.owner, "terminal");
  } finally {
    dashboard.close();
    session.server?.close();
  }
});
