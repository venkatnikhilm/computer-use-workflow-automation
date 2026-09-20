import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDecision, WireDecision } from "../src/discovery.js";
import { z } from "zod";
test("flat provider actions normalize null fields and require symbolic bindings", () => {
  assert.deepEqual(parseDecision({ action: "click", element: "directory" }), {
    action: "click",
    element: "directory",
    input: null,
  });
  assert.deepEqual(parseDecision({ action: "finish" }), {
    action: "finish",
    element: null,
    input: null,
  });
  assert.equal(
    parseDecision({
      action: "fill",
      element: "lookup_field",
      input: "customer_ref",
    }).input,
    "customer_ref",
  );
  for (const invalid of [
    { action: "fill", element: "lookup_field" },
    { action: "click", element: "directory", input: "member_id" },
    { action: "finish", element: "balance" },
    { action: "fill", element: "lookup_field", input: "12345" },
    { action: "click", target: { by: "css", value: "a" } },
  ])
    assert.throws(() => parseDecision(invalid));
});
test("provider schema is serializable and has the flat action contract", () => {
  const schema = z.toJSONSchema(WireDecision);
  const action = schema.properties?.action;
  assert(action && typeof action === "object");
  assert.deepEqual(action.enum, ["fill", "click", "finish"]);
  assert.equal(schema.additionalProperties, false);
});
