import { randomBytes, randomUUID } from "node:crypto";
import { createServer, Server } from "node:http";
import { RunError } from "./contracts.js";
import { Events } from "./events.js";
export class Session {
  operatorURL = "";
  owner: "automation" | "human" | "validating" = "automation";
  assisted = false;
  intervention = "";
  server?: Server;
  constructor(
    readonly events: Events,
    readonly interactive: boolean,
  ) {}
  assertAutomation() {
    if (this.owner !== "automation") throw new RunError("CONTROL_NOT_OWNED");
  }
  async handoff(code: string, validate: () => Promise<boolean>) {
    if (!this.interactive) throw new RunError("INTERVENTION_REQUIRED");
    this.owner = "human";
    this.assisted = true;
    this.intervention = randomUUID();
    this.events.emit("intervention", { code });
    const token = randomBytes(24).toString("hex");
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const end = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.server?.close();
        error ? reject(error) : resolve();
      };
      const timer = setTimeout(
        () => end(new RunError("INTERVENTION_TIMEOUT")),
        120000,
      );
      this.server = createServer(async (req, res) => {
        if (req.url !== `/${token}`) {
          res.writeHead(404);
          res.end();
          return;
        }
        if (req.method === "GET") {
          res.setHeader("Content-Type", "text/html");
          res.end(
            `<h1>Browser intervention</h1><p>${code}</p><p>Operate the existing banking browser, then resume.</p><form method="POST"><button name="action" value="resume">Resume</button><button name="action" value="cancel">Cancel</button></form>`,
          );
          return;
        }
        if (req.method !== "POST" || this.owner !== "human") {
          res.writeHead(409);
          res.end();
          return;
        }
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 200) {
            res.writeHead(413);
            res.end();
            return;
          }
        }
        if (this.owner !== "human") {
          res.writeHead(409);
          res.end();
          return;
        }
        if (body === "action=cancel") {
          res.end("Cancelled");
          end(new RunError("CANCELLED"));
          return;
        }
        if (body !== "action=resume") {
          res.writeHead(400);
          res.end();
          return;
        }
        this.owner = "validating";
        try {
          if (!(await validate())) {
            this.owner = "human";
            res.writeHead(409);
            res.end(
              "Checkpoint not satisfied. Resolve the blocker and try again.",
            );
            return;
          }
          this.owner = "automation";
          this.events.emit("resumed", { assisted: true });
          res.end("Resumed");
          end();
        } catch {
          res.end("Session lost");
          end(new RunError("SESSION_LOST"));
        }
      });
      this.server.listen(0, "127.0.0.1", () => {
        const address = this.server!.address();
        if (address && typeof address !== "string") {
          this.operatorURL = `http://127.0.0.1:${address.port}/${token}`;
          console.log(`Operator: ${this.operatorURL}`);
        }
      });
    });
  }
}
