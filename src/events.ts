import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
export class Events {
  readonly id = randomUUID();
  readonly history: { type: string; step?: number; code?: string }[] = [];
  readonly directory: string;
  constructor(root = "runs") {
    this.directory = join(root, this.id);
    mkdirSync(this.directory, { recursive: true });
  }
  emit(
    type: string,
    fields: {
      match_count?: number;
      profile_digest?: string;
      artifact_digest?: string;
      tenant_id?: string;
      step?: number;
      code?: string;
      action?: string;
      assisted?: boolean;
      model_calls?: number;
      schema_errors?: { code: string; path: string }[];
      http_status?: number;
      wait_ms?: number;
      quota_scope?: "per_minute" | "per_day" | "mixed" | "unknown";
      retry_after_ms?: number;
    } = {},
  ) {
    this.history.push({ type, step: fields.step, code: fields.code });
    if (this.history.length > 200) this.history.shift();
    appendFileSync(
      join(this.directory, "events.jsonl"),
      JSON.stringify({
        run_id: this.id,
        time: new Date().toISOString(),
        type,
        ...fields,
      }) + "\n",
    );
  }
  snapshot(structure: unknown) {
    writeFileSync(
      join(this.directory, "failure.json"),
      JSON.stringify(structure, null, 2),
    );
  }
}
