import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
export class Events {
  readonly id = randomUUID();
  readonly directory: string;
  constructor(root = "runs") {
    this.directory = join(root, this.id);
    mkdirSync(this.directory, { recursive: true });
  }
  emit(
    type: string,
    fields: {
      step?: number;
      code?: string;
      action?: string;
      assisted?: boolean;
      model_calls?: number;
    } = {},
  ) {
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
