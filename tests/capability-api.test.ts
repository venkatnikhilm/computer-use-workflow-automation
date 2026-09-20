import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startCapabilityApi,
  browserExecutor,
  loadCatalog,
} from "../src/capability-api.js";
import { startDemo } from "../demo/server.js";

test("catalog exposes typed schemas without browser selectors or artifact file paths", () => {
  const catalog = loadCatalog().map((c) => c.description);
  assert.deepEqual(
    catalog.map((c) => c.name),
    ["get_savings_balance", "get_member_contact"],
  );
  assert.deepEqual(catalog[1]!.input_schema.required, ["customer_ref"]);
  assert.equal(catalog[1]!.input_schema.additionalProperties, false);
  assert.equal(catalog[1]!.input_schema.properties.customer_ref!.minLength, 5);
  assert(!JSON.stringify(catalog).includes("#member-id"));
  assert(!JSON.stringify(catalog).includes(".json"));
});

test("API rejects unauthenticated, unknown, malformed and oversized calls before execution", async () => {
  let calls = 0;
  const api = await startCapabilityApi(async () => {
    calls++;
    return { status: "success", run_id: "test" };
  });
  const headers = {
    Authorization: `Bearer ${api.token}`,
    "Content-Type": "application/json",
  };
  try {
    assert.equal((await fetch(api.url + "/capabilities")).status, 401);
    assert.equal(
      (
        await fetch(api.url + "/capabilities", {
          headers: { ...headers, Origin: "https://example.test" },
        })
      ).status,
      401,
    );
    for (const [name, body, status] of [
      ["unknown", "{}", 404],
      ["get_member_contact", '{"arguments":{"customer_ref":67890}}', 400],
      [
        "get_member_contact",
        '{"arguments":{"customer_ref":"67890","extra":"x"}}',
        400,
      ],
      [
        "get_member_contact",
        '{"arguments":{"customer_ref":"67890"},"file":"other.json"}',
        400,
      ],
      ["get_member_contact", "not json", 400],
      ["get_member_contact", "x".repeat(9000), 413],
    ] as const) {
      const response = await fetch(`${api.url}/capabilities/${name}/invoke`, {
        method: "POST",
        headers,
        body,
      });
      assert.equal(response.status, status);
    }
    assert.equal(calls, 0);
  } finally {
    await api.close();
  }
});

test("API admits one invocation at a time and releases its slot after failure", async () => {
  let entered!: () => void;
  const started = new Promise<void>((r) => (entered = r));
  let release!: () => void;
  const blocker = new Promise<void>((r) => (release = r));
  const api = await startCapabilityApi(async () => {
    entered();
    await blocker;
    throw Error("Sensitive internal details");
  });
  const options = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${api.token}`,
      "Content-Type": "application/json",
    },
    body: '{"arguments":{"customer_ref":"67890"}}',
  };
  try {
    const first = fetch(
      api.url + "/capabilities/get_member_contact/invoke",
      options,
    );
    await started;
    assert.equal(
      (
        await fetch(
          api.url + "/capabilities/get_member_contact/invoke",
          options,
        )
      ).status,
      409,
    );
    release();
    const response = await first;
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { code: "EXECUTION_FAILED" });
    assert.equal(
      (
        await fetch(
          api.url + "/capabilities/get_member_contact/invoke",
          options,
        )
      ).status,
      500,
    );
  } finally {
    release();
    await api.close();
  }
});

test("HTTP invocation executes a discovered artifact and preserves business outcomes", async () => {
  const demo = await startDemo(0);
  const address = demo.address();
  assert(address && typeof address !== "string");
  const api = await startCapabilityApi(
    browserExecutor(`http://127.0.0.1:${address.port}`),
  );
  try {
    const headers = {
      Authorization: `Bearer ${api.token}`,
      "Content-Type": "application/json",
    };
    for (const [name, args, expected] of [
      ["get_member_contact", { customer_ref: "67890" }, "success"],
      ["get_savings_balance", { member_id: "99999" }, "business_outcome"],
    ] as const) {
      const response = await fetch(`${api.url}/capabilities/${name}/invoke`, {
        method: "POST",
        headers,
        body: JSON.stringify({ arguments: args }),
      });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.status, expected);
      if (expected === "success")
        assert.equal(result.outputs.email, "jordan@example.test");
      else assert.equal(result.code, "MEMBER_NOT_FOUND");
      assert(!Object.hasOwn(result, "evidence"));
    }
  } finally {
    await api.close();
    await new Promise<void>((r) => demo.close(() => r()));
  }
});
