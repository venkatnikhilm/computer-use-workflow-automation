import { test } from "node:test";
import assert from "node:assert/strict";
import { Session } from "../src/session.js";
import { Events } from "../src/events.js";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("late resume validation cannot restore control after an intervention timeout", async () => {
  const session = new Session(
    new Events(mkdtempSync(join(tmpdir(), "session-timeout-"))),
    true,
    200,
  );
  let resolveValidation!: (value: boolean) => void;
  const validation = new Promise<boolean>(
    (resolve) => (resolveValidation = resolve),
  );
  const outcome = session
    .handoff("TEST_BLOCKER", () => validation)
    .catch((error) => error);
  while (!session.operatorURL) await new Promise((r) => setTimeout(r, 2));
  const response = fetch(session.operatorURL, {
    method: "POST",
    body: "action=resume",
  });
  const error = await outcome;
  assert.equal(error.code, "INTERVENTION_TIMEOUT");
  assert.equal(session.owner, "terminal");
  resolveValidation(true);
  assert.equal((await response).status, 409);
  assert.equal(session.owner, "terminal");
  session.server?.close();
});
