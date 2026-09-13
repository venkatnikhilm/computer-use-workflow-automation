import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { createDemoAuth } from "./auth.js";
export async function startDemo(
  port = 4173,
  scenario = "normal",
  now = Date.now,
) {
  const auth = ["login", "login-expiry"].includes(scenario)
    ? createDemoAuth(scenario === "login-expiry", now)
    : undefined;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    const id = url.searchParams.get("member") ?? "";
    const safe = /^\d{5}$/.test(id) ? id : "";
    const known = ["12345", "67890", "11111", "22222"].includes(safe);
    const authBody = await auth?.(req, res, url);
    if (res.writableEnded) return;
    let body = "";
    if (authBody != null) body = authBody;
    else if (url.pathname === "/")
      body = '<h1>Member services</h1><a href="/members">Members</a>';
    else if (url.pathname === "/members")
      body =
        '<h1>Member search</h1><form action="/results"><label>Member ID <input name="member" pattern="[0-9]{5}" required></label><button>Search</button></form>';
    else if (url.pathname === "/results") {
      if (scenario === "slow") await new Promise((r) => setTimeout(r, 700));
      body = `<h1>Search results</h1>${known ? `<a href="/member?member=${safe}">Open member</a>` : '<p role="status">Member not found</p>'}`;
    } else if (url.pathname === "/member")
      body = `<h1>Member details</h1><p>Member ID: <span id="member-id">${safe}</span></p>${safe === "11111" ? '<p role="status">No savings account</p>' : `<a href="/account?member=${safe}">Savings</a>${safe === "22222" ? `<a href="/account?member=${safe}&extra=1">Savings</a>` : ""}`}`;
    else if (url.pathname === "/account") {
      if (scenario === "auth" && !req.headers.cookie?.includes("demo-auth=1"))
        body = `<h1>Session expired</h1><p>Human authentication required</p><form action="/authenticate"><input type="hidden" name="member" value="${safe}"><button>Restore demo session</button></form>`;
      else if (scenario === "unknown")
        body = "<h1>Service unavailable</h1><p>Contact an operator.</p>";
      else
        body = `<h1>Savings account</h1><dl><dt>Member ID</dt><dd id="member-id">${safe}</dd><dt>Account kind</dt><dd id="account-kind">savings</dd><dt>Current balance</dt><dd id="balance">${safe === "67890" ? "2450.75" : "100.00"}</dd><dt>Currency</dt><dd id="currency">USD</dd></dl><button onclick="location.href='/transfer'">Transfer funds</button>`;
    } else if (url.pathname === "/authenticate" && scenario === "auth") {
      res.writeHead(302, {
        "Set-Cookie": "demo-auth=1; HttpOnly; SameSite=Strict; Path=/",
        Location: `/account?member=${safe}`,
      });
      res.end();
      return;
    } else {
      res.writeHead(404);
      res.end();
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      `<!doctype html><html lang="en"><head><meta name="application" content="bank-demo-v1"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Harbor Credit Union · Staff Demo</title><style>body{font:16px system-ui;margin:0;background:#eef2f6;color:#172b41}header{background:#12354a;color:white;padding:24px max(24px,calc((100% - 800px)/2))}header strong{font-size:23px}header small{display:block;margin-top:6px;color:#bcd3df}main{max-width:720px;margin:40px auto;padding:32px;background:white;border:1px solid #d8e1e8;border-radius:12px}h1{font-size:28px}a,button{display:inline-block;margin:16px 10px 16px 0;padding:12px 20px;background:#126859;color:white;border:0;border-radius:6px;font:inherit;cursor:pointer}label{display:block;margin:20px 0;font-weight:600}input{display:block;box-sizing:border-box;padding:12px;margin-top:8px;width:100%;max-width:400px;border:1px solid #889ba9;border-radius:5px;font:inherit}input[type=hidden]{display:none}dd{margin:8px 0 20px;font-size:22px}aside{padding:18px;background:#eff5fa;line-height:1.8;border-radius:6px}footer{max-width:720px;margin:24px auto;padding:0 24px;color:#506477;font-size:14px}[role=alert]{background:#fff1ef;border-left:4px solid #b13529;padding:14px}.eyebrow{font-size:12px;letter-spacing:2px;color:#507487}.secondary{background:#e7eef3;color:#172b41}@media(max-width:800px){main{margin:20px;padding:24px}}</style></head><body><header><strong>Harbor Credit Union</strong><small>Staff banking · Fictional local demonstration</small></header><main>${body}</main><footer>Training environment. Synthetic member data only. No real banking transactions.</footer></body></html>`,
    );
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  return server;
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startDemo(Number(process.env.PORT ?? 4173), process.env.SCENARIO);
  console.log(`Demo: http://127.0.0.1:${process.env.PORT ?? 4173}`);
}
