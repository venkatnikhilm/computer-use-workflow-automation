import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { normalizeCapability } from "./compatibility.js";
import { Workflow, Field, validateParameters } from "./workflow-contracts.js";
import { digest, harborProfile, type Profile } from "./profile.js";
import { Surface } from "./browser.js";
import { Events } from "./events.js";
import { Session } from "./session.js";
import { defaultPolicy, type PolicyInput } from "./policy.js";
import { replay } from "./replay.js";
import { RunError } from "./contracts.js";

function fieldSchema(field: z.infer<typeof Field>) {
  return {
    type: "string",
    minLength: field.min_length,
    maxLength: field.max_length,
    ...(field.values ? { enum: field.values } : {}),
    ...(field.type === "digits" ? { pattern: "^[0-9]+$" } : {}),
    ...(field.type === "decimal" ? { pattern: "^-?[0-9]+\\.[0-9]{2}$" } : {}),
    ...(field.type === "currency" ? { pattern: "^[A-Z]{3}$" } : {}),
    "x-sensitivity": field.sensitivity,
  };
}
function objectSchema(fields: Record<string, z.infer<typeof Field>>) {
  return {
    type: "object",
    properties: Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [key, fieldSchema(value)]),
    ),
    required: Object.keys(fields),
    additionalProperties: false,
  };
}

/** Deployment-owned registry. Request bodies cannot supply artifact files, routes, or policy. */
export function loadCatalog() {
  const files = ["savings.json", "contact.discovered.v2.json"];
  return files.map((file) => {
    const raw: unknown = JSON.parse(
      readFileSync(new URL(`../capabilities/${file}`, import.meta.url), "utf8"),
    );
    const workflow = Workflow.parse(normalizeCapability(raw));
    return {
      raw,
      workflow,
      description: {
        name: workflow.id,
        version: workflow.version,
        description: workflow.goal,
        artifact_digest: digest(raw),
        input_schema: objectSchema(workflow.inputs),
        output_schema: objectSchema(
          Object.fromEntries(
            Object.entries(workflow.outputs).map(([key, output]) => [
              key,
              output.field,
            ]),
          ),
        ),
      },
    };
  });
}
export type ApiResult = {
  status: string;
  run_id: string;
  outputs?: Record<string, string>;
  code?: string;
  assisted?: boolean;
  step?: number;
};
type Executor = (
  raw: unknown,
  args: Record<string, string>,
) => Promise<ApiResult>;
export function browserExecutor(
  base: string,
  profile: Profile = harborProfile,
  policy: PolicyInput = defaultPolicy,
): Executor {
  return async (raw, args) => {
    const events = new Events();
    const surface = new Surface(
      base,
      events,
      new Session(events, false),
      policy,
      profile,
    );
    try {
      await surface.open();
      const result = await replay(raw, args, surface);
      // Only the authorized caller receives outputs; internal evidence paths stay local.
      return {
        status: result.status,
        run_id: events.id,
        ...(result.outputs ? { outputs: result.outputs } : {}),
        ...(result.code ? { code: result.code } : {}),
        ...(result.assisted !== undefined ? { assisted: result.assisted } : {}),
        ...(result.step !== undefined ? { step: result.step } : {}),
      };
    } catch (error) {
      const code = error instanceof RunError ? error.code : "EXECUTION_FAILED";
      events.emit("failure", { code, model_calls: 0 });
      await surface.evidence();
      return { status: "failure", run_id: events.id, code };
    } finally {
      await surface.close();
    }
  };
}

/** Local synchronous invocation API, one browser run at a time, no queue or model client. */
export async function startCapabilityApi(execute: Executor, port = 0) {
  const catalog = loadCatalog();
  const token = randomBytes(32).toString("hex");
  let busy = false;
  const server = createServer(async (req, res) => {
    const send = (status: number, data: unknown) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(JSON.stringify(data));
    };
    if (req.headers.authorization !== `Bearer ${token}` || req.headers.origin) {
      send(401, { code: "UNAUTHORIZED" });
      return;
    }
    if (req.method === "GET" && req.url === "/capabilities") {
      send(200, { capabilities: catalog.map((c) => c.description) });
      return;
    }
    const match = /^\/capabilities\/([a-z][a-z0-9_]{0,63})\/invoke$/.exec(
      req.url ?? "",
    );
    const entry = match && catalog.find((c) => c.workflow.id === match[1]);
    if (req.method !== "POST" || !entry) {
      send(404, { code: "CAPABILITY_NOT_FOUND" });
      return;
    }
    if (req.headers["content-type"]?.split(";")[0] !== "application/json") {
      send(415, { code: "JSON_REQUIRED" });
      return;
    }
    let args: Record<string, string>;
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 8192) {
          send(413, { code: "REQUEST_TOO_LARGE" });
          return;
        }
        chunks.push(Buffer.from(chunk));
      }
      const request = z
        .object({ arguments: z.unknown() })
        .strict()
        .parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      args = validateParameters(entry.workflow, request.arguments);
    } catch {
      send(400, { code: "INVALID_ARGUMENTS" });
      return;
    }
    if (busy) {
      send(409, { code: "RUN_IN_PROGRESS" });
      return;
    }
    busy = true;
    try {
      send(200, await execute(structuredClone(entry.raw), args));
    } catch {
      send(500, { code: "EXECUTION_FAILED" });
    } finally {
      busy = false;
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw Error("API_BIND_FAILED");
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
    token,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
