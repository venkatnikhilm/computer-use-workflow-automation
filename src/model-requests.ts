import { z } from "zod";
import { RunError } from "./contracts.js";
import { Events } from "./events.js";

export const RequestLimits = z
  .object({
    maxCalls: z.number().int().min(1).max(20).default(6),
    minIntervalMs: z.number().int().min(0).max(60000).default(15000),
    maxRetries: z.number().int().min(0).max(2).default(0),
    timeoutMs: z.number().int().min(1).max(60000).default(30000),
  })
  .strict();
export type Limits = z.infer<typeof RequestLimits>;
export function requestLimitsFromEnv(env: NodeJS.ProcessEnv): Limits {
  const number = (key: string) =>
    env[key] === undefined ? undefined : Number(env[key]);
  return RequestLimits.parse({
    maxCalls: number("MODEL_MAX_CALLS"),
    minIntervalMs: number("MODEL_MIN_INTERVAL_MS"),
    maxRetries: number("MODEL_MAX_RETRIES"),
    timeoutMs: number("MODEL_TIMEOUT_MS"),
  });
}

type Diagnostics = {
  http_status: number;
  quota_scope?: "per_minute" | "per_day" | "mixed" | "unknown";
  retry_after_ms?: number;
};
/** Extract only fixed categories and bounded numbers; never persist provider prose,
 * quota IDs, project names, prompts, headers or URLs. */
export async function errorDiagnostics(
  response: Response,
  now = Date.now(),
): Promise<Diagnostics> {
  const result: Diagnostics = { http_status: response.status };
  if (response.status !== 429) return result;
  result.quota_scope = "unknown";
  const delays: number[] = [];
  const header = response.headers.get("retry-after");
  if (header) {
    const milliseconds = /^\d+(\.\d+)?$/.test(header)
      ? Number(header) * 1000
      : Date.parse(header) - now;
    if (
      Number.isFinite(milliseconds) &&
      milliseconds >= 0 &&
      milliseconds <= 86400000
    )
      delays.push(milliseconds);
  }
  try {
    const body = await response.json();
    const details = Array.isArray(body?.error?.details)
      ? body.error.details
      : [];
    const scopes = new Set<string>();
    for (const detail of details) {
      if (!detail || typeof detail !== "object") continue;
      if (
        detail["@type"] === "type.googleapis.com/google.rpc.RetryInfo" &&
        typeof detail.retryDelay === "string" &&
        /^\d+(\.\d+)?s$/.test(detail.retryDelay)
      ) {
        const delay = Number(detail.retryDelay.slice(0, -1)) * 1000;
        if (delay <= 86400000) delays.push(delay);
      }
      if (detail["@type"] !== "type.googleapis.com/google.rpc.QuotaFailure")
        continue;
      for (const violation of Array.isArray(detail.violations)
        ? detail.violations
        : []) {
        const id =
          typeof violation?.quotaId === "string" ? violation.quotaId : "";
        if (/PerMinute/i.test(id)) scopes.add("per_minute");
        else if (/PerDay/i.test(id)) scopes.add("per_day");
        else scopes.add("unknown");
      }
    }
    if (scopes.size > 1) result.quota_scope = "mixed";
    else if (scopes.size === 1)
      result.quota_scope = [...scopes][0] as Diagnostics["quota_scope"];
  } catch {
    /* Status remains useful even when the error body is malformed. */
  }
  if (delays.length) result.retry_after_ms = Math.ceil(Math.max(...delays));
  return result;
}

interface Dependencies {
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}
/** One controller per discovery run. Serializes requests, including retries.
 * Counts dispatches, not successful decisions. Does not represent project-wide quota. */
export class ModelRequests {
  calls = 0;
  private lastStarted: number | undefined;
  private stopped: string | undefined;
  private queue: Promise<void> = Promise.resolve();
  private readonly limits: Limits;
  private readonly deps: Dependencies;
  constructor(
    readonly events: Events,
    limits: Partial<Limits> = {},
    deps: Partial<Dependencies> = {},
  ) {
    this.limits = RequestLimits.parse(limits);
    this.deps = {
      fetch: globalThis.fetch,
      now: () => performance.now(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      ...deps,
    };
  }
  request(
    url: string,
    options: Omit<RequestInit, "signal">,
  ): Promise<Response> {
    const result = this.queue.then(() => this.perform(url, options));
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  private async perform(
    url: string,
    options: Omit<RequestInit, "signal">,
  ): Promise<Response> {
    for (let attempt = 0; attempt <= this.limits.maxRetries; attempt++) {
      if (this.stopped) throw new RunError(this.stopped);
      if (this.calls >= this.limits.maxCalls) {
        this.stopped = "MODEL_CALL_BUDGET_EXHAUSTED";
        this.events.emit("model_stopped", {
          code: this.stopped,
          model_calls: this.calls,
        });
        throw new RunError(this.stopped);
      }
      if (this.lastStarted !== undefined) {
        const delay = Math.max(
          0,
          this.limits.minIntervalMs - (this.deps.now() - this.lastStarted),
        );
        if (delay > 0) {
          this.events.emit("model_wait", {
            wait_ms: delay,
            model_calls: this.calls,
          });
          await this.deps.sleep(delay);
        }
      }
      this.calls++;
      this.lastStarted = this.deps.now();
      this.events.emit("model_request", { model_calls: this.calls });
      const controller = new AbortController();
      // Start the timeout only after pacing, and clear it after body consumption.
      const timer = setTimeout(() => controller.abort(), this.limits.timeoutMs);
      let response: Response;
      try {
        const raw = await this.deps.fetch(url, {
          ...options,
          signal: controller.signal,
        });
        const body = await raw.arrayBuffer();
        response = new Response(body, {
          status: raw.status,
          statusText: raw.statusText,
          headers: raw.headers,
        });
      } catch {
        this.stopped = controller.signal.aborted
          ? "MODEL_TIMEOUT"
          : "MODEL_TRANSPORT_FAILED";
        this.events.emit("model_stopped", {
          code: this.stopped,
          model_calls: this.calls,
        });
        throw new RunError(this.stopped);
      } finally {
        clearTimeout(timer);
      }
      if (response.ok) {
        this.events.emit("model_response", {
          http_status: response.status,
          model_calls: this.calls,
        });
        return response;
      }
      const details = await errorDiagnostics(response);
      this.events.emit("model_error", { ...details, model_calls: this.calls });
      if (
        [502, 503, 504].includes(response.status) &&
        attempt < this.limits.maxRetries
      )
        continue;
      this.stopped =
        response.status === 429
          ? "MODEL_RATE_LIMITED"
          : `MODEL_HTTP_${response.status}`;
      throw new RunError(this.stopped);
    }
    throw new RunError("MODEL_UNAVAILABLE");
  }
}
