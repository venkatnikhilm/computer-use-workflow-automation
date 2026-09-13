import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDecision, WireDecision } from "../src/discovery.js";
import { z } from "zod";

test("flat provider actions normalize optional null fields without relaxing binding rules", () => {
  assert.deepEqual(
    parseDecision({
      action: "click",
      target: { by: "role", role: "link", value: "Members" },
    }),
    {
      action: {
        action: "click",
        target: { by: "role", role: "link", value: "Members" },
      },
      finish: false,
    },
  );
  assert.deepEqual(parseDecision({ action: "finish" }), {
    action: null,
    finish: true,
  });
  assert.equal(
    parseDecision({
      action: "fill",
      target: { by: "role", role: "textbox", value: "Member ID" },
      input: "member_id",
    }).action?.input,
    "member_id",
  );
  assert.throws(() =>
    parseDecision({
      action: "fill",
      target: { by: "label", value: "Member ID" },
    }),
  );
  assert.throws(() =>
    parseDecision({
      action: "click",
      target: { by: "role", role: "link", value: "Members" },
      input: "member_id",
    }),
  );
  assert.throws(() =>
    parseDecision({
      action: "finish",
      target: { by: "css", value: "#balance" },
    }),
  );
  assert.throws(() =>
    parseDecision({
      action: "fill",
      target: { by: "label", value: "Member ID" },
      input: "12345",
    }),
  );
});
test("provider schema is serializable and has the flat action contract", () => {
  const schema = z.toJSONSchema(WireDecision);
  const action = schema.properties?.action;
  assert(action && typeof action === "object");
  assert.deepEqual(action.enum, ["click", "fill", "finish"]);
  assert.equal(schema.additionalProperties, false);
});
