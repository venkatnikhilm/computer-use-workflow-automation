import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Events } from "../src/events.js";
import {
  ModelRequests,
  errorDiagnostics,
  requestLimitsFromEnv,
} from "../src/model-requests.js";
function harness(statuses: number[], limits = {}) {
  let clock = 0;
  const starts: number[] = [];
  const events = new Events(mkdtempSync(join(tmpdir(), "model-limits-")));
  const requests = new ModelRequests(events, limits, {
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    fetch: async () => {
      starts.push(clock);
      return new Response("{}", { status: statuses.shift() ?? 200 });
    },
  });
  return { requests, starts, events };
}
test("budget includes retried requests and prevents another dispatch", async () => {
  const { requests, starts } = harness([503, 200, 200], {
    maxCalls: 2,
    maxRetries: 1,
  });
  await requests.request("https://mock.invalid", {});
  await assert.rejects(
    () => requests.request("https://mock.invalid", {}),
    /MODEL_CALL_BUDGET_EXHAUSTED/,
  );
  assert.equal(requests.calls, 2);
  assert.deepEqual(starts, [0, 15000]);
});
test("concurrent callers are serialized and paced", async () => {
  const { requests, starts } = harness([200, 200, 200]);
  await Promise.all(
    [1, 2, 3].map(() => requests.request("https://mock.invalid", {})),
  );
  assert.deepEqual(starts, [0, 15000, 30000]);
});
test("429 stops immediately, including queued requests, even with retries enabled", async () => {
  const { requests, starts, events } = harness([429, 200], { maxRetries: 2 });
  const results = await Promise.allSettled([
    requests.request("https://mock.invalid", {}),
    requests.request("https://mock.invalid", {}),
  ]);
  assert(
    results.every(
      (r) =>
        r.status === "rejected" && /MODEL_RATE_LIMITED/.test(String(r.reason)),
    ),
  );
  assert.equal(starts.length, 1);
  assert(
    readFileSync(join(events.directory, "events.jsonl"), "utf8").includes(
      '"quota_scope":"unknown"',
    ),
  );
});
test("503 has no automatic retry by default", async () => {
  const { requests, starts } = harness([503, 200]);
  await assert.rejects(
    () => requests.request("https://mock.invalid", {}),
    /MODEL_HTTP_503/,
  );
  assert.equal(starts.length, 1);
});
test("quota diagnostics retain categories and delay but no provider prose or identifiers", async () => {
  const secret = "DO_NOT_PERSIST";
  const response = new Response(
    JSON.stringify({
      error: {
        message: secret,
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.QuotaFailure",
            violations: [
              {
                quotaId: "GenerateRequestsPerMinutePerProject-FreeTier",
                subject: secret,
                description: secret,
              },
            ],
          },
          {
            "@type": "type.googleapis.com/google.rpc.RetryInfo",
            retryDelay: "12.5s",
          },
        ],
      },
    }),
    { status: 429, headers: { "Retry-After": "10" } },
  );
  const diagnostic = await errorDiagnostics(response);
  assert.deepEqual(diagnostic, {
    http_status: 429,
    quota_scope: "per_minute",
    retry_after_ms: 12500,
  });
  assert(!JSON.stringify(diagnostic).includes(secret));
  assert.deepEqual(
    await errorDiagnostics(new Response("not json", { status: 429 })),
    { http_status: 429, quota_scope: "unknown" },
  );
});
test("daily and mixed limits are reported only when quota IDs support them", async () => {
  const response = (ids: string[]) =>
    new Response(
      JSON.stringify({
        error: {
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.QuotaFailure",
              violations: ids.map((quotaId) => ({ quotaId })),
            },
          ],
        },
      }),
      { status: 429 },
    );
  assert.equal(
    (await errorDiagnostics(response(["RequestsPerDay"]))).quota_scope,
    "per_day",
  );
  assert.equal(
    (await errorDiagnostics(response(["RequestsPerDay", "TokensPerMinute"])))
      .quota_scope,
    "mixed",
  );
});
test("transport failures count toward the budget and do not leak errors", async () => {
  const events = new Events(mkdtempSync(join(tmpdir(), "model-transport-")));
  const requests = new ModelRequests(
    events,
    {},
    {
      fetch: async () => {
        throw Error("SECRET_KEY");
      },
    },
  );
  await assert.rejects(
    () => requests.request("https://mock.invalid", {}),
    /MODEL_TRANSPORT_FAILED/,
  );
  assert.equal(requests.calls, 1);
  assert(
    !readFileSync(join(events.directory, "events.jsonl"), "utf8").includes(
      "SECRET_KEY",
    ),
  );
});
test("timeout begins after pacing and each request gets a fresh signal", async () => {
  let clock = 0;
  const signals: AbortSignal[] = [];
  const events = new Events(mkdtempSync(join(tmpdir(), "model-timeout-")));
  const requests = new ModelRequests(
    events,
    { timeoutMs: 10 },
    {
      now: () => clock,
      sleep: async (ms) => {
        await new Promise((r) => setTimeout(r, 20));
        clock += ms;
      },
      fetch: async (_url, options) => {
        signals.push(options!.signal!);
        assert.equal(options!.signal!.aborted, false);
        return new Response("{}");
      },
    },
  );
  await requests.request("https://mock.invalid", {});
  await requests.request("https://mock.invalid", {});
  assert.notEqual(signals[0], signals[1]);
  assert(signals.every((s) => !s.aborted));
});
test("invalid budgets fail before requests; defaults are conservative", () => {
  assert.equal(requestLimitsFromEnv({}).maxCalls, 6);
  assert.equal(requestLimitsFromEnv({}).maxRetries, 0);
  assert.throws(() => requestLimitsFromEnv({ MODEL_MAX_CALLS: "NaN" }));
  assert.throws(() => requestLimitsFromEnv({ MODEL_MAX_CALLS: "0" }));
  assert.throws(() => requestLimitsFromEnv({ MODEL_MIN_INTERVAL_MS: "-1" }));
});

test("a timed-out dispatch is counted once and stops later calls", async () => {
  const events = new Events(mkdtempSync(join(tmpdir(), "model-abort-")));
  const requests = new ModelRequests(
    events,
    { timeoutMs: 5 },
    {
      fetch: async (_url, options) =>
        new Promise((_resolve, reject) => {
          options!.signal!.addEventListener(
            "abort",
            () => reject(Error("private transport details")),
            { once: true },
          );
        }),
    },
  );
  await assert.rejects(
    () => requests.request("https://mock.invalid", {}),
    /MODEL_TIMEOUT/,
  );
  await assert.rejects(
    () => requests.request("https://mock.invalid", {}),
    /MODEL_TIMEOUT/,
  );
  assert.equal(requests.calls, 1);
});
