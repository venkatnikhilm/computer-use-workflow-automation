import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

/** An independent application: different routes, metadata, records, and unlabeled legacy forms. */
export async function startInventory(
  port = 4182,
  variant = "east",
  scenario = "normal",
) {
  if (!["east", "west"].includes(variant))
    throw Error("Unknown inventory variant");
  const labels =
    variant === "east"
      ? { link: "Stock lookup", input: "Item code", submit: "Find stock" }
      : { link: "Inventory search", input: "Part number", submit: "Locate" };
  const server = createServer((req, res) => {
    const url = new URL(req.url!, "http://127.0.0.1");
    if (req.method !== "GET") {
      res.writeHead(405);
      res.end();
      return;
    }
    let body = "";
    if (url.pathname === "/")
      body = `<h1>Warehouse console</h1><a href="/lookup">${labels.link}</a>`;
    else if (url.pathname === "/lookup") {
      const labelId = `label-${randomUUID()}`;
      const field = `<input id="field-${randomUUID()}" name="sku" ${scenario === "labeled" ? `aria-labelledby="${labelId}" placeholder="Item identifier" title="Lookup code"` : ""}>`;
      const row = `<tr><th><span id="${labelId}">${labels.input}</span></th><td><div>${field}</div></td></tr>`;
      body = `<h1>Find inventory</h1><form method="get" action="/record"><table>${row}${scenario === "ambiguous" ? row : ""}</table><button>${labels.submit}</button></form><form method="post" action="/delete"><button>Delete stock</button></form>`;
    } else if (url.pathname === "/record") {
      const key = url.searchParams.get("sku");
      const record =
        key === "ITEM-A"
          ? ["12", "North depot"]
          : key === "ITEM-B"
            ? ["7", "South depot"]
            : undefined;
      body = record
        ? `<h1>Inventory record</h1><table><tr><th>${labels.input}</th><td>${key}</td></tr><tr><th>Available units</th><td>${record[0]}</td></tr><tr><th>Warehouse</th><td>${record[1]}</td></tr></table>`
        : '<h1>Search results</h1><p role="status">Item not found</p>';
    } else {
      res.writeHead(404);
      res.end();
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      `<!doctype html><html lang="en"><title>Inventory demo</title><body data-product="inventory-console" data-workspace="warehouse-${variant}" data-release="2026.1"><main>${body}</main></body></html>`,
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const server = await startInventory(
    Number(process.env.PORT ?? 4182),
    process.env.TENANT ?? "east",
  );
  const address = server.address();
  console.log(
    `Inventory demo: http://127.0.0.1:${typeof address === "object" && address ? address.port : "unknown"}`,
  );
}
