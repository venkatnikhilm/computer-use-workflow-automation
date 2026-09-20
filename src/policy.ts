import { z } from "zod";
const route = z.string().regex(/^\/[a-z0-9/_-]*$/);
const common = {
  routes: z.array(route).min(1),
  actions: z.array(z.enum(["click", "fill"])),
  link_labels: z.array(z.string().max(80)),
  fill_names: z.array(z.string().max(80)),
};
const LegacyPolicy = z
  .object({ ...common, search_form: z.literal("/results") })
  .strict();
export const ApplicationPolicy = z
  .object({
    schema_version: z.literal(2),
    ...common,
    read_forms: z.array(route).min(1),
    submit_labels: z.array(z.string().min(1).max(80)),
  })
  .strict();
export const Policy = z.union([LegacyPolicy, ApplicationPolicy]);
export type PolicyInput = z.infer<typeof Policy>;
export function executionPolicy(raw: PolicyInput) {
  const parsed = Policy.parse(raw);
  return "schema_version" in parsed
    ? parsed
    : {
        ...parsed,
        read_forms: [parsed.search_form] as string[],
        submit_labels: ["Search"],
      };
}
export const defaultPolicy = LegacyPolicy.parse({
  routes: [
    "/",
    "/members",
    "/results",
    "/member",
    "/account",
    "/authenticate",
    "/login",
    "/verify",
    "/logout",
  ],
  actions: ["click", "fill"],
  link_labels: ["Members", "Open member", "Savings"],
  fill_names: ["member"],
  search_form: "/results",
});
