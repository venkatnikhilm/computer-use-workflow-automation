import { z } from "zod";
import { Target, RunError } from "./contracts.js";

const name = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const path = z.string().regex(/^\/[a-z/]*$/);
const sensitivity = z.enum(["public", "sensitive"]);
export const Field = z
  .object({
    type: z.enum(["string", "digits", "decimal", "currency"]),
    min_length: z.number().int().min(1).max(256).default(1),
    max_length: z.number().int().min(1).max(256).default(128),
    values: z.array(z.string().min(1).max(256)).min(1).max(32).optional(),
    sensitivity,
  })
  .strict()
  .refine((x) => x.min_length <= x.max_length);
export const Element = z
  .object({
    candidates: z.array(Target).min(1).max(4),
    scope: Target.optional(),
  })
  .strict();
export const Binding = z.union([
  z.object({ input: name }).strict(),
  z.object({ literal: z.string().max(256) }).strict(),
]);
export const Condition = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("path"), value: path }).strict(),
  z
    .object({ kind: z.literal("query_equals"), key: name, value: Binding })
    .strict(),
  z
    .object({ kind: z.literal("text_equals"), element: name, value: Binding })
    .strict(),
  z
    .object({ kind: z.literal("field_equals"), element: name, value: Binding })
    .strict(),
  z
    .object({
      kind: z.literal("count"),
      element: name,
      equals: z.number().int().min(0).max(100),
    })
    .strict(),
]);
export const WorkflowStep = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("fill"),
      element: name,
      input: name,
      postcondition: z
        .object({
          kind: z.literal("field_equals"),
          element: name,
          value: z.object({ input: name }).strict(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal("click"),
      element: name,
      postcondition: z
        .object({ kind: z.literal("path"), value: path })
        .strict(),
    })
    .strict(),
]);
const Rule = z
  .object({
    when: z.array(Condition).min(1).max(8),
    require: z.array(Condition).min(1).max(8),
    code: z.string().regex(/^[A-Z][A-Z_]{0,63}$/),
  })
  .strict();
const Outcome = z
  .object({
    when: z.array(Condition).min(1).max(8),
    code: z.string().regex(/^[A-Z][A-Z_]{0,63}$/),
  })
  .strict();
export const TaskShape = z
  .object({
    schema_version: z.literal(2),
    id: name,
    version: z.number().int().positive(),
    application: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    goal: z.string().min(1).max(1000),
    entry_path: path,
    inputs: z.record(name, Field),
    elements: z.record(name, Element),
    outputs: z.record(name, z.object({ field: Field, element: name }).strict()),
    invariants: z.array(Rule).max(32),
    outcomes: z.array(Outcome).max(32),
    completion: z.array(Condition).min(1).max(16),
  })
  .strict();
export type TaskType = z.infer<typeof TaskShape>;
export type ConditionType = z.infer<typeof Condition>;
export type ElementType = z.infer<typeof Element>;
export type WorkflowStepType = z.infer<typeof WorkflowStep>;
export type Parameters = Record<string, string>;

function validateReferences(
  task: TaskType,
  ctx: z.RefinementCtx,
  steps: WorkflowStepType[] = [],
) {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  const element = (key: string) => {
    if (!Object.hasOwn(task.elements, key)) issue("Unknown element reference");
  };
  const input = (key: string) => {
    if (!Object.hasOwn(task.inputs, key)) issue("Unknown input reference");
  };
  const condition = (c: ConditionType) => {
    if ("element" in c) element(c.element);
    if ("value" in c && typeof c.value !== "string" && "input" in c.value)
      input(c.value.input);
  };
  if (!Object.keys(task.inputs).length || Object.keys(task.inputs).length > 16)
    issue("Expected 1–16 inputs");
  if (
    !Object.keys(task.outputs).length ||
    Object.keys(task.outputs).length > 16
  )
    issue("Expected 1–16 outputs");
  if (
    !Object.keys(task.elements).length ||
    Object.keys(task.elements).length > 64
  )
    issue("Expected 1–64 elements");
  Object.values(task.outputs).forEach((o) => element(o.element));
  task.completion.forEach(condition);
  task.invariants.forEach((r) => [...r.when, ...r.require].forEach(condition));
  task.outcomes.forEach((r) => r.when.forEach(condition));
  for (const step of steps) {
    element(step.element);
    condition(step.postcondition);
    if (step.action === "fill") {
      input(step.input);
      if (
        step.postcondition.element !== step.element ||
        step.postcondition.value.input !== step.input
      )
        issue("Fill checkpoint must verify its own input and element");
    }
  }
}
export const Task = TaskShape.superRefine((task, ctx) =>
  validateReferences(task, ctx),
);
export const Workflow = TaskShape.extend({
  steps: z.array(WorkflowStep).min(1).max(30),
  provenance: z
    .object({
      kind: z.enum(["llm-discovery", "development-fixture"]),
      run_id: z.string().uuid(),
      task_digest: z.string().regex(/^[a-f0-9]{64}$/),
      model: z
        .string()
        .regex(/^gemini-[a-z0-9.-]+$/)
        .optional(),
      api_attempts: z.number().int().min(1).max(20).optional(),
    })
    .strict(),
}).superRefine((task, ctx) => validateReferences(task, ctx, task.steps));
export type WorkflowType = z.infer<typeof Workflow>;

export function validateValue(
  field: z.infer<typeof Field>,
  value: unknown,
): string {
  if (
    typeof value !== "string" ||
    value.length < field.min_length ||
    value.length > field.max_length ||
    (field.values && !field.values.includes(value)) ||
    (field.type === "digits" && !/^\d+$/.test(value)) ||
    (field.type === "decimal" && !/^-?\d+\.\d{2}$/.test(value)) ||
    (field.type === "currency" && !/^[A-Z]{3}$/.test(value))
  )
    throw new RunError("INVALID_VALUE");
  return value;
}
export function validateParameters(task: TaskType, raw: unknown): Parameters {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new RunError("INVALID_INVOCATION");
  const values = raw as Record<string, unknown>;
  if (Object.keys(values).length !== Object.keys(task.inputs).length)
    throw new RunError("INVALID_INVOCATION");
  return Object.fromEntries(
    Object.entries(task.inputs).map(([key, field]) => {
      if (!Object.hasOwn(values, key)) throw new RunError("INVALID_INVOCATION");
      return [key, validateValue(field, values[key])];
    }),
  );
}
export function bind(value: z.infer<typeof Binding>, inputs: Parameters) {
  if ("literal" in value) return value.literal;
  if (!Object.hasOwn(inputs, value.input))
    throw new RunError("INVALID_BINDING");
  return inputs[value.input]!;
}
