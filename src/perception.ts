import type { Page, Frame } from "playwright";
import { Target } from "./contracts.js";
import { locate } from "./targeting.js";

/** Candidate descriptions are derived afresh; DOM identifiers and entered values are never recorded. */
export async function observeControls(document: Page | Frame) {
  const groups = await document.locator("body").evaluate((body) => {
    const text = {
      clean(value: string | null | undefined) {
        return value?.replace(/\s+/g, " ").trim() ?? "";
      },
    };
    return Array.from(body.querySelectorAll("input,button,a"))
      .filter((node) => (node as HTMLElement).offsetWidth > 0)
      .slice(0, 100)
      .map((node) => {
        const candidates: { by: string; value: string; role?: string }[] = [];
        const output = {
          add(by: string, value: string, role?: string) {
            if (value && value.length <= 160)
              candidates.push({ by, value, ...(role ? { role } : {}) });
          },
        };
        if (node instanceof HTMLInputElement) {
          if (!["text", "search"].includes(node.type)) return [];
          const referenced = (node.getAttribute("aria-labelledby") ?? "")
            .split(/\s+/)
            .map((id) =>
              text.clean(node.ownerDocument.getElementById(id)?.textContent),
            )
            .filter(Boolean)
            .join(" ");
          output.add(
            referenced &&
              (node.getAttribute("aria-labelledby") ?? "").trim().split(/\s+/)
                .length > 1
              ? "role"
              : "label",
            referenced ||
              text.clean(node.getAttribute("aria-label")) ||
              text.clean(node.labels?.[0]?.textContent),
            referenced &&
              (node.getAttribute("aria-labelledby") ?? "").trim().split(/\s+/)
                .length > 1
              ? node.type === "search"
                ? "searchbox"
                : "textbox"
              : undefined,
          );
          // Only a non-control cell in the input's nearest row can supply a structural label.
          const cells = Array.from(node.closest("tr")?.children ?? []);
          for (const cell of cells) {
            if (cell.contains(node)) break;
            if (
              ["TH", "TD"].includes(cell.tagName) &&
              !cell.querySelector("input,select,textarea,button,table")
            )
              output.add("near_text", text.clean(cell.textContent));
          }
          output.add(
            "placeholder",
            text.clean(node.getAttribute("placeholder")),
          );
          output.add("title", text.clean(node.getAttribute("title")));
        } else {
          output.add(
            "role",
            text.clean(node.getAttribute("aria-label")) ||
              text.clean(node.textContent),
            node.tagName === "A" ? "link" : "button",
          );
          output.add("title", text.clean(node.getAttribute("title")));
        }
        return candidates.slice(0, 4);
      });
  });
  return groups.map((group) => group.map((target) => Target.parse(target)));
}

/** Every saved alternative must resolve uniquely to the SAME live node as the selected descriptor. */
export async function verifiedCandidates(
  document: Page | Frame,
  selected: ReturnType<typeof Target.parse>,
) {
  const primary = locate(document, selected);
  if ((await primary.count()) !== 1) return [selected]; // The gateway reports ambiguity/missing explicitly.
  const groups = await observeControls(document);
  const group = groups.find((g) =>
    g.some((t) => JSON.stringify(t) === JSON.stringify(selected)),
  );
  const result = [selected];
  const node = await primary.elementHandle();
  if (!node) return result;
  try {
    for (const alternative of group ?? []) {
      if (JSON.stringify(alternative) === JSON.stringify(selected)) continue;
      const candidate = locate(document, alternative);
      if (
        (await candidate.count()) === 1 &&
        (await candidate.evaluate(
          (element, original) => element === original,
          node,
        ))
      )
        result.push(alternative);
    }
  } finally {
    await node.dispose();
  }
  return result.slice(0, 4);
}
