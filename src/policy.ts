import { z } from "zod";
export const Policy = z
  .object({
    routes: z.array(z.string().regex(/^\/[a-z/]*$/)).min(1),
    actions: z.array(z.enum(["click", "fill"])),
    link_labels: z.array(z.string().max(80)),
    fill_names: z.array(z.string().max(80)),
    search_form: z.literal("/results"),
  })
  .strict();
export const defaultPolicy = Policy.parse({
  routes: ["/", "/members", "/results", "/member", "/account", "/authenticate"],
  actions: ["click", "fill"],
  link_labels: ["Members", "Open member", "Savings"],
  fill_names: ["member"],
  search_form: "/results",
});
