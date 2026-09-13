import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import type { Events } from "./events.js";
import type { Session } from "./session.js";

export class Dashboard {
  server?: Server;
  url = "";
  private ended = false;
  private expiry?: ReturnType<typeof setTimeout>;
  constructor(
    readonly events: Events,
    readonly session: Session,
    readonly tenant: string,
  ) {}
  state() {
    const history = this.events.history;
    const final = [...history]
      .reverse()
      .find((e) => ["success", "failure", "business_outcome"].includes(e.type));
    const completed = history
      .filter((e) => e.type === "step_completed")
      .map((e) => e.step);
    const blocker = [...history]
      .reverse()
      .find((e) => e.type === "intervention");
    return {
      run_id: this.events.id,
      tenant:
        this.tenant === "summit"
          ? "Summit Community Bank"
          : "Harbor Credit Union",
      capability: "Get savings balance",
      owner: this.ended ? "terminal" : this.session.owner,
      steps: this.session.stepLabels.map((label, i) => ({
        label,
        status: completed.includes(i)
          ? "complete"
          : i === completed.length && !this.ended
            ? "current"
            : "pending",
      })),
      status: this.ended
        ? (final?.type ?? "finished")
        : this.session.owner === "human"
          ? "Waiting for you"
          : "Running",
      code: this.ended
        ? final?.code
        : this.session.owner === "human"
          ? blocker?.code
          : undefined,
      assisted: this.session.assisted,
    };
  }
  async start() {
    const token = randomBytes(24).toString("hex");
    this.server = createServer(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (req.url !== `/${token}` && req.url !== `/${token}/status`) {
        res.writeHead(404);
        res.end();
        return;
      }
      if (req.method === "GET" && req.url.endsWith("/status")) {
        res.setHeader("Content-Type", "application/json");
        let guidance = "Automation is operating the banking window.";
        if (this.ended)
          guidance =
            "Run ended. Validated outputs, if any, are in your terminal. You can close this dashboard.";
        else if (this.session.owner === "human") {
          try {
            guidance = await this.session.guidance();
          } catch {
            guidance = "The banking window is unavailable. Cancel this run.";
          }
        }
        res.end(JSON.stringify({ ...this.state(), guidance }));
        return;
      }
      if (req.method === "GET") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(html);
        return;
      }
      if (req.method !== "POST" || req.url.endsWith("/status")) {
        res.writeHead(405);
        res.end();
        return;
      }
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 100) {
          res.writeHead(413);
          res.end();
          return;
        }
      }
      if (
        this.ended ||
        this.session.owner !== "human" ||
        !["action=resume", "action=cancel"].includes(body)
      ) {
        res.writeHead(409);
        res.end();
        return;
      }
      // Reuse the session's serialized validation and control-transfer path.
      try {
        const response = await fetch(this.session.operatorURL, {
          method: "POST",
          body,
        });
        res.writeHead(response.status);
        res.end(
          response.ok
            ? "Request accepted"
            : "Not ready. Follow the instructions above and try again.",
        );
      } catch {
        res.writeHead(409);
        res.end("The intervention has ended.");
      }
    });
    await new Promise<void>((resolve) =>
      this.server!.listen(0, "127.0.0.1", resolve),
    );
    const address = this.server.address();
    if (address && typeof address !== "string")
      this.url = `http://127.0.0.1:${address.port}/${token}`;
    return this.url;
  }
  finish() {
    this.ended = true;
    this.expiry = setTimeout(() => this.close(), 60000);
  }
  close() {
    clearTimeout(this.expiry);
    this.server?.close();
  }
}
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Automation operator</title><style>
body{font:16px system-ui;background:#eef3f7;color:#193044;margin:0}header{background:#153b50;color:white;padding:24px}main{max-width:880px;margin:32px auto;padding:0 20px}.card{background:white;border:1px solid #d4dfe7;border-radius:12px;padding:24px;margin:16px 0}h1{margin:0;font-size:25px}h2{font-size:20px}#status{font-weight:700;color:#116b58}li{padding:12px;border-bottom:1px solid #edf1f4}.complete{color:#116b58}.current{font-weight:bold;color:#194f96}button{padding:12px 22px;margin-right:12px;border:0;border-radius:6px;background:#126859;color:white;font:inherit;cursor:pointer}button:last-child{background:#8f3434}button:disabled{opacity:.45;cursor:default}small{color:#65788a}#feedback{color:#8f3434}#guidance{line-height:1.6}code{overflow-wrap:anywhere}</style></head><body><header><h1>Automation operator</h1></header><main><section class="card"><small id="tenant"></small><h2 id="capability"></h2><p id="status">Connecting…</p><small>Run <code id="run"></code></small></section><section class="card"><h2>Workflow progress</h2><ol id="steps"></ol></section><section class="card"><h2>What happens next</h2><p id="guidance"></p><p id="reason"></p><button id="resume" disabled>Resume</button><button id="cancel" disabled>Cancel run</button><p id="feedback" role="status"></p></section></main><script>
const el=id=>document.getElementById(id);let busy=false;let terminal=false;
async function refresh(){try{const response=await fetch(location.pathname+'/status');if(!response.ok)throw Error();const s=await response.json();el('tenant').textContent=s.tenant;el('capability').textContent=s.capability;el('run').textContent=s.run_id;el('status').textContent=s.status+(s.assisted?' · Human assisted':'');el('guidance').textContent=s.guidance;el('reason').textContent=s.code?'Reason: '+s.code:'';el('steps').replaceChildren(...s.steps.map(x=>{const li=document.createElement('li');li.className=x.status;li.textContent=x.label+' — '+x.status;return li}));terminal=s.owner==='terminal';el('resume').disabled=busy||s.owner!=='human';el('cancel').disabled=busy||s.owner!=='human';}catch{if(!terminal)el('feedback').textContent='Dashboard disconnected. Check the terminal for the run result.';}}
for(const action of ['resume','cancel'])el(action).onclick=async()=>{busy=true;await refresh();try{const r=await fetch(location.pathname,{method:'POST',body:'action='+action});el('feedback').textContent=await r.text();}catch{el('feedback').textContent='Connection ended. Check the terminal.';}busy=false;await refresh();};refresh();setInterval(()=>{if(!terminal)refresh()},750);
</script></body></html>`;
