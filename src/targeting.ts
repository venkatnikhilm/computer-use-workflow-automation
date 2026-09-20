import type { Page, Frame, Locator } from "playwright";
import type { z } from "zod";
import type { Target } from "./contracts.js";

/** Deterministic structural relationships; callers enforce uniqueness before acting. */
export function locate(
  root: Page | Frame | Locator,
  target: z.infer<typeof Target>,
): Locator {
  if (target.by === "placeholder")
    return root.getByPlaceholder(target.value, { exact: true });
  if (target.by === "title")
    return root.getByTitle(target.value, { exact: true });
  if (target.by === "near_text") {
    const literal = target.value.includes("'")
      ? `concat(${target.value
          .split("'")
          .map((part) => `'${part}'`)
          .join(`, "'", `)})`
      : `'${target.value}'`;
    return root.locator(
      `xpath=.//input[not(@type="hidden")][ancestor::tr[1]/*[self::th or self::td][normalize-space(.)=${literal}]]`,
    );
  }
  if (target.by === "css") return root.locator(target.value);
  if (target.by === "label")
    return root.getByLabel(target.value, { exact: true });
  if (target.by === "role")
    return root.getByRole(target.role, { name: target.value, exact: true });
  const row = root
    .getByText(target.value, { exact: true })
    .locator("xpath=ancestor::tr[1]");
  return row.locator(":scope > td");
}
