import { z } from "zod";
import { createHash } from "node:crypto";
import { Target, defaultExtraction } from "./contracts.js";
const label = z.string().trim().min(1).max(80);
export const TenantProfile = z
  .object({
    schema_version: z.literal(1),
    tenant_id: z.enum(["harbor", "summit"]),
    application: z.literal("bank-demo-v1"),
    layout_version: z.literal("1"),
    frame_name: z
      .string()
      .regex(/^[a-z][a-z0-9_-]{0,39}$/)
      .optional(),
    member_input: Target.optional(),
    base_url: z
      .string()
      .url()
      .refine((raw) => {
        const u = new URL(raw);
        return (
          u.protocol === "http:" &&
          ["127.0.0.1", "localhost"].includes(u.hostname) &&
          !u.username &&
          !u.password &&
          u.pathname === "/" &&
          !u.search &&
          !u.hash
        );
      }),
    labels: z
      .object({
        members: label,
        member_id: label,
        search: label,
        open_member: label,
        savings: label,
      })
      .strict(),
    extraction: z
      .object({
        member: Target,
        account_kind: Target,
        balance: Target,
        currency: Target,
      })
      .strict(),
  })
  .strict();
export type Profile = z.infer<typeof TenantProfile>;
export function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export const harborProfile = TenantProfile.parse({
  schema_version: 1,
  tenant_id: "harbor",
  application: "bank-demo-v1",
  layout_version: "1",
  base_url: "http://127.0.0.1:4173/",
  labels: {
    members: "Members",
    member_id: "Member ID",
    search: "Search",
    open_member: "Open member",
    savings: "Savings",
  },
  extraction: defaultExtraction,
});
// Only known vendor locator slots can be overridden. Steps, routes and policy are not profile fields.
export function resolveProfileTarget(
  target: z.infer<typeof Target>,
  profile: Profile,
) {
  const slots = [
    [
      { by: "role", role: "link", value: "Members" },
      { by: "role", role: "link", value: profile.labels.members },
    ],
    [
      { by: "label", value: "Member ID" },
      profile.member_input ?? { by: "label", value: profile.labels.member_id },
    ],
    [
      { by: "role", role: "button", value: "Search" },
      { by: "role", role: "button", value: profile.labels.search },
    ],
    [
      { by: "role", role: "link", value: "Open member" },
      { by: "role", role: "link", value: profile.labels.open_member },
    ],
    [
      { by: "role", role: "link", value: "Savings" },
      { by: "role", role: "link", value: profile.labels.savings },
    ],
    ...Object.entries(defaultExtraction).map(([key, value]) => [
      value,
      profile.extraction[key as keyof typeof defaultExtraction],
    ]),
  ];
  const match = slots.find(
    ([source]) =>
      source?.by === target.by &&
      source?.value === target.value &&
      (source as { role?: string }).role === (target as { role?: string }).role,
  );
  return match ? Target.parse(match[1]) : target;
}
