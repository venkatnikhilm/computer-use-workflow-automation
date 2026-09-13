import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
export async function startDemo(port = 4173, scenario = "normal") {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    const id = url.searchParams.get("member") ?? "";
    const safe = /^\d{5}$/.test(id) ? id : "";
    const known = ["12345", "67890", "11111", "22222"].includes(safe);
    let body = "";
    if (url.pathname === "/")
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
    } else if (url.pathname === "/authenticate") {
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
    res.setHeader("Content-Type", "text/html");
    res.end(
      `<!doctype html><html lang="en"><head><meta name="application" content="bank-demo-v1"><title>Bank Demo</title><style>body{font:18px system-ui;max-width:760px;margin:60px auto;background:#f4f6fa;color:#172438}a,button{display:inline-block;margin:16px 10px 16px 0;padding:12px;background:#174f94;color:white;border:0;border-radius:6px}input{padding:10px}dd{margin:8px 0 20px}</style></head><body>${body}</body></html>`,
    );
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  return server;
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startDemo(Number(process.env.PORT ?? 4173), process.env.SCENARIO);
  console.log(`Demo: http://127.0.0.1:${process.env.PORT ?? 4173}`);
}
