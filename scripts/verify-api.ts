import assert from "node:assert/strict";
import { mkdirSync, copyFileSync, writeFileSync, readFileSync } from "node:fs";
import { startDemo } from "../demo/server.js";
import { startCapabilityApi, browserExecutor } from "../src/capability-api.js";
const demo = await startDemo(0);
const address = demo.address();
assert(address && typeof address !== "string");
const api = await startCapabilityApi(
  browserExecutor(`http://127.0.0.1:${address.port}`),
);
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  assert.equal(
    new URL(url).origin,
    api.url,
    "Only the local capability API may be called",
  );
  return originalFetch(input, init);
};
try {
  const headers = {
    Authorization: `Bearer ${api.token}`,
    "Content-Type": "application/json",
  };
  const catalogResponse = await fetch(api.url + "/capabilities", { headers });
  assert.equal(catalogResponse.status, 200);
  const catalog = await catalogResponse.json();
  const capability = catalog.capabilities.find(
    (c: { name: string }) => c.name === "get_member_contact",
  );
  assert(capability);
  assert.deepEqual(capability.input_schema.required, ["customer_ref"]);
  const response = await fetch(
    `${api.url}/capabilities/${capability.name}/invoke`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ arguments: { customer_ref: "67890" } }),
    },
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.status, "success");
  assert.deepEqual(result.outputs, {
    email: "jordan@example.test",
    phone: "202-555-0182",
    membership_status: "active",
  });
  const logs = readFileSync(`runs/${result.run_id}/events.jsonl`, "utf8");
  for (const value of [
    "67890",
    "jordan@example.test",
    "202-555-0182",
    api.token,
    '"model_request"',
  ])
    assert(!logs.includes(value));
  const dir = "evidence/capability-api";
  mkdirSync(dir, { recursive: true });
  copyFileSync(`runs/${result.run_id}/events.jsonl`, `${dir}/events.jsonl`);
  writeFileSync(`${dir}/catalog.json`, JSON.stringify(catalog, null, 2) + "\n");
  writeFileSync(
    `${dir}/summary.json`,
    JSON.stringify(
      {
        demonstration:
          "Programmatic caller lists capabilities and invokes a selected name over HTTP; no LLM caller is claimed.",
        capability: capability.name,
        artifact_digest: capability.artifact_digest,
        run_id: result.run_id,
        status: result.status,
        output_checked: true,
        model_calls: 0,
        assisted: result.assisted,
      },
      null,
      2,
    ) + "\n",
  );
  console.log("Catalog discovery: success");
  console.log(
    "get_member_contact via HTTP: success, typed outputs checked, zero model calls",
  );
} finally {
  globalThis.fetch = originalFetch;
  await api.close();
  await new Promise<void>((resolve) => demo.close(() => resolve()));
}
