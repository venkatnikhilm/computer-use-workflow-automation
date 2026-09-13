import { z } from "zod";
export const Target = z
  .object({
    by: z.enum(["label", "role", "css"]),
    value: z.string().min(1).max(160),
    role: z.enum(["button", "link", "heading"]).optional(),
  })
  .strict();
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
    version: z.literal(1),
    application: z.literal("bank-demo-v1"),
    inputs: z.object({ member_id: z.literal("string:5-digits") }).strict(),
    outputs: z
      .object({
        balance: z.literal("decimal-string"),
        currency: z.literal("ISO-4217"),
      })
      .strict(),
    steps: z.array(Step).min(3).max(20),
    completion: z.literal("member-and-savings-identity"),
    handler_profile: z.literal("bank-conditions-v1"),
    provenance: z
      .object({
        kind: z.enum(["llm-discovery", "development-fixture"]),
        run_id: z.string().uuid(),
      })
      .strict(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (
      c.steps.some(
        (s) =>
          (s.action === "fill") !== (s.input === "member_id") ||
          !s.postcondition,
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
