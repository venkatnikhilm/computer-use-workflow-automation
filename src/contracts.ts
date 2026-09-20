import { z } from "zod";
const targetValue = z.string().trim().min(1).max(160);
export const Target = z.discriminatedUnion("by", [
  z.object({ by: z.literal("label"), value: targetValue }).strict(),
  z.object({ by: z.literal("css"), value: targetValue }).strict(),
  z.object({ by: z.literal("placeholder"), value: targetValue }).strict(),
  z.object({ by: z.literal("title"), value: targetValue }).strict(),
  z.object({ by: z.literal("near_text"), value: targetValue }).strict(),
  z.object({ by: z.literal("row_value"), value: targetValue }).strict(),
  z
    .object({
      by: z.literal("role"),
      value: targetValue,
      role: z.enum(["button", "link", "heading", "textbox", "searchbox"]),
    })
    .strict(),
]);
export const Extraction = z
  .object({
    member: Target,
    account_kind: Target,
    balance: Target,
    currency: Target,
  })
  .strict();
export const defaultExtraction = Extraction.parse({
  member: { by: "css", value: "#member-id" },
  account_kind: { by: "css", value: "#account-kind" },
  balance: { by: "css", value: "#balance" },
  currency: { by: "css", value: "#currency" },
});
export const Step = z
  .object({
    action: z.enum(["fill", "click"]),
    target: Target,
    input: z.literal("member_id").optional(),
    postcondition: z
      .discriminatedUnion("kind", [
        z
          .object({
            kind: z.literal("field_equals_input"),
            input: z.literal("member_id"),
          })
          .strict(),
        z
          .object({
            kind: z.literal("path"),
            value: z.string().regex(/^\/[a-z/]*$/),
          })
          .strict(),
      ])
      .optional(),
  })
  .strict();
export const Capability = z
  .object({
    schema_version: z.literal(1),
    id: z.literal("get_savings_balance"),
    version: z.number().int().positive(),
    application: z.literal("bank-demo-v1"),
    inputs: z.object({ member_id: z.literal("string:5-digits") }).strict(),
    outputs: z
      .object({
        balance: z.literal("decimal-string"),
        currency: z.literal("ISO-4217"),
      })
      .strict(),
    extraction: Extraction.default(defaultExtraction),
    steps: z.array(Step).min(3).max(20),
    completion: z.literal("member-and-savings-identity"),
    handler_profile: z.literal("bank-conditions-v1"),
    provenance: z
      .object({
        kind: z.enum(["llm-discovery", "development-fixture"]),
        run_id: z.string().uuid(),
        model: z
          .string()
          .regex(/^gemini-[a-z0-9.-]+$/)
          .optional(),
        api_attempts: z.number().int().min(1).max(20).optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (
      c.steps.some(
        (s) =>
          (s.action === "fill") !== (s.input === "member_id") ||
          !s.postcondition ||
          (s.action === "fill" &&
            s.postcondition.kind !== "field_equals_input") ||
          (s.action === "click" && s.postcondition.kind !== "path"),
      )
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Steps require postconditions and fills require parameter bindings",
      });
  });
export type CapabilityType = z.infer<typeof Capability>;
export type StepType = z.infer<typeof Step>;
export const Input = z
  .object({ member_id: z.string().regex(/^\d{5}$/) })
  .strict();
export class RunError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
