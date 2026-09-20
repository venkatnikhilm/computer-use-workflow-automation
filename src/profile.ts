import { z } from "zod";
import { createHash } from "node:crypto";
import { Target, defaultExtraction } from "./contracts.js";
const label = z.string().trim().min(1).max(80);
const LegacyTenantProfile = z
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

export function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export const harborProfile = LegacyTenantProfile.parse({
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
const identifier = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
export const ApplicationProfile = z
  .object({
    schema_version: z.literal(2),
    tenant_id: identifier,
    application: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    display_name: label,
    base_url: z
      .string()
      .url()
      .refine((raw) => {
        const u = new URL(raw);
        return (
          ["http:", "https:"].includes(u.protocol) &&
          !u.username &&
          !u.password &&
          u.pathname === "/" &&
          !u.search &&
          !u.hash
        );
      }),
    frame_name: identifier.optional(),
    markers: z
      .array(
        z
          .object({
            target: Target,
            attribute: z
              .string()
              .regex(/^[a-z][a-z0-9-]{0,63}$/)
              .optional(),
            expected: z.string().min(1).max(160),
            code: z.enum([
              "INCOMPATIBLE_APP",
              "TENANT_MISMATCH",
              "UNSUPPORTED_APP_VERSION",
            ]),
          })
          .strict(),
      )
      .min(1)
      .max(8),
    authentication: z
      .array(
        z
          .object({ target: Target, guidance: z.string().min(1).max(300) })
          .strict(),
      )
      .max(8),
    overrides: z.array(z.object({ from: Target, to: Target }).strict()).max(64),
  })
  .strict()
  .superRefine((p, ctx) => {
    for (const code of [
      "INCOMPATIBLE_APP",
      "TENANT_MISMATCH",
      "UNSUPPORTED_APP_VERSION",
    ])
      if (!p.markers.some((m) => m.code === code))
        ctx.addIssue({
          code: "custom",
          message: "Application, tenant, and version markers are required",
        });
    if (
      new Set(p.overrides.map((o) => JSON.stringify(o.from))).size !==
      p.overrides.length
    )
      ctx.addIssue({ code: "custom", message: "Conflicting overrides" });
  });
export const TenantProfile = z.union([LegacyTenantProfile, ApplicationProfile]);
export type Profile = z.infer<typeof TenantProfile>;
export type ApplicationConfig = z.infer<typeof ApplicationProfile>;

/** The original banking profile is translated at the configuration boundary only. */
export function applicationConfig(profile: Profile): ApplicationConfig {
  if (profile.schema_version === 2) return profile;
  const overrides = [
    {
      from: { by: "role", role: "link", value: "Members" },
      to: { by: "role", role: "link", value: profile.labels.members },
    },
    {
      from: { by: "label", value: "Member ID" },
      to: profile.member_input ?? {
        by: "label",
        value: profile.labels.member_id,
      },
    },
    {
      from: { by: "role", role: "button", value: "Search" },
      to: { by: "role", role: "button", value: profile.labels.search },
    },
    {
      from: { by: "role", role: "link", value: "Open member" },
      to: { by: "role", role: "link", value: profile.labels.open_member },
    },
    {
      from: { by: "role", role: "link", value: "Savings" },
      to: { by: "role", role: "link", value: profile.labels.savings },
    },
    ...Object.entries(defaultExtraction).map(([key, from]) => ({
      from,
      to: profile.extraction[key as keyof typeof defaultExtraction],
    })),
  ];
  return ApplicationProfile.parse({
    schema_version: 2,
    tenant_id: profile.tenant_id,
    application: profile.application,
    display_name:
      profile.tenant_id === "summit"
        ? "Summit Community Bank"
        : "Harbor Credit Union",
    base_url: profile.base_url,
    frame_name: profile.frame_name,
    overrides,
    markers: [
      {
        target: { by: "css", value: 'meta[name="application"]' },
        attribute: "content",
        expected: profile.application,
        code: "INCOMPATIBLE_APP",
      },
      {
        target: { by: "css", value: 'meta[name="tenant"]' },
        attribute: "content",
        expected: profile.tenant_id,
        code: "TENANT_MISMATCH",
      },
      {
        target: { by: "css", value: 'meta[name="layout-version"]' },
        attribute: "content",
        expected: profile.layout_version,
        code: "UNSUPPORTED_APP_VERSION",
      },
    ],
    authentication: [
      {
        target: { by: "role", role: "heading", value: "Verify your identity" },
        guidance:
          "Complete verification in the application window, then return here and click Resume.",
      },
      {
        target: { by: "css", value: "[data-auth-required]" },
        guidance:
          "Complete sign-in and verification in the application window, then click Resume here.",
      },
      {
        target: { by: "role", role: "heading", value: "Session expired" },
        guidance:
          "Restore the session in the application window, then click Resume here.",
      },
    ],
  });
}
export function resolveProfileTarget(
  target: z.infer<typeof Target>,
  profile: Profile,
) {
  // Object key order is not semantically significant.
  const equivalent = applicationConfig(profile).overrides.find(
    (entry) =>
      Object.keys(entry.from).length === Object.keys(target).length &&
      Object.entries(entry.from).every(
        ([key, value]) => (target as Record<string, unknown>)[key] === value,
      ),
  );
  return equivalent?.to ?? target;
}
