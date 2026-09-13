# Architecture

The implementation is one TypeScript application controlling a local Chromium session, plus a fictional banking demo server. A genuine Gemini 3.5 Flash Lite run discovered a five-action savings lookup. The unchanged artifact then returned another member's balance and passed seven replay scenarios. Discovery made five API requests; replay makes none. Public evidence distinguishes live discovery, unattended replay, and a simulated operator.

The discovery controller observes the rendered page/accessibility snapshot, requests one schema-validated action, and sends it through the shared browser action gateway. It does not receive a prerecorded sequence. The gateway checks policy, resolves the real control, executes it, and verifies the effect. The builder retains only successful actions, replaces invocation values with explicit parameter bindings, and adds an authored completion/extraction contract. Completion is checked after every action, avoiding an unnecessary final model call.

The replay interpreter imports `ExecutionSurface`, not Playwright or a model SDK. That interface contains operations, validation, extraction, and handoff readiness. The browser implementation owns pages/locators; the session owns control state; the event sink persists sanitized evidence. These are modules in one process rather than distributed services. Request budgets, pacing, and bounded timeouts limit discovery cost and execution time.

# Artifact schema

A strict Zod schema validates `schema_version`, capability identity/revision, application version, typed input/output declarations, extraction targets, ordered steps, postconditions, a named completion rule, handler-profile version, and provenance. Schema versions fail closed; capability revisions use positive integers. The demo input is a five-digit string, preserving leading zeros. Balance is a decimal string, avoiding binary floating-point conversion; the implemented application profile accepts USD.

Each click stores a reusable target and resulting path; each fill binds `member_id` and verifies the field value. Exact label/role targets identify the demo's controls without test IDs. CSS supports explicit extraction locations. Model-supplied transient references are not persisted; the gateway derives canonical descriptors from permitted controls. A successful first resolution is not treated as proof of reuse: the saved artifact is tested on another member. Extraction targets for member identity, account kind, balance, and currency are serialized and independently tested with changed selectors.

Completion and business handlers are deliberately authored application semantics, not claims that one happy-path run discovered all exceptions. They are referenced by version in the artifact. The evidence manifest binds every replay to the original artifact's SHA-256 digest. Original discovery bytes are preserved. There is no arbitrary code, general loop construct, or model-driven locator repair in replay.

# Determinism & error handling

Before acting, replay validates the entire artifact, input, declared actions, and destination checkpoints against policy. Every target must match exactly one visible enabled control. Fills replace and verify values; clicks wait for navigation within a finite bound and check the recorded path. Final extraction validates member identity, savings account kind, uniqueness/visibility, decimal format, and currency. The same rules run for every invocation; live balances may differ.

`MEMBER_NOT_FOUND`, `NO_SAVINGS_ACCOUNT`, and `AMBIGUOUS_ACCOUNT` are business outcomes scoped to the correct screen and member. Slow responses use bounded waiting. Unknown states produce a failure identifying the step and expected/observed condition, plus sanitized structural evidence. Unavailable controls before dispatch may request a human intervention and retry once after validation. Already-dispatched clicks are never blindly repeated. Unknown mutating actions are blocked, so transaction reconciliation is not implemented in this read-only slice.

Discovery uses a flat structured response schema, normalizes omitted optional fields, and validates tool bindings before dispatch. It escalates repeated failures/no progress. Six API attempts per run and 15-second spacing are defaults; optional transient retries count against that same budget. HTTP 429 stops immediately with sanitized quota-scope diagnostics. These controls are per run, not a project-wide quota service.

# Heterogeneity & multi-tenant

The chosen surface is server-rendered web HTML with forms and no automation-only identifiers. Replay's `ExecutionSurface` boundary lets a future adapter supply equivalent actions/checks over desktop accessibility APIs or a legacy frame-aware browser implementation. Target variants are explicitly web-oriented today; a desktop adapter must reject them until a compatible accessibility/visual target type and deterministic resolver exist. Raw coordinates are not claimed to be portable.

For shared vendor software, keep immutable base capability revisions separate from tenant settings: starting URL, locale, application version, authentication context, policy, and narrowly permitted locator overrides. Today `DEMO_URL`, isolated browser contexts, application-marker checks, and `POLICY_FILE` provide the first separation. A future tenant profile would reference an exact capability revision and override target descriptors by stable step ID, never arbitrary actions or permissions. Merge and validate before running, record both digests, and run tenant smoke checks before promotion. Unknown versions, ambiguous targets, or incompatible checkpoints stop; they do not silently heal or rewrite the shared artifact. Full profiles/desktop support are design-only, as allowed by the assignment.

# Escalation & handoff

An authentication blocker, stuck discovery, or supported replay blocker yields an intervention containing capability, run, step, reason, and sanitized state evidence. Automation stops at a settled action boundary. A localhost operator page exposes Resume/Cancel while the same headed browser stays open. The operator resolves the blocker there; no fresh browser loses entered context. Resume passes through validation; premature/duplicate submissions are rejected. Failed or timed-out interventions terminate, and a late validation callback cannot restore automation ownership.

The current runner executes actions sequentially. Gateway ownership checks reject automated actions during human control; direct local mouse/keyboard access is a trusted-operator boundary rather than remote input fencing. Capture-phase instrumentation records manual click/change/submit/navigation event types without entered values. Browser chrome and OS actions are outside that capture. The checkpoint after resume prevents repeating completed work. An assisted discovery is not published because manual steps are not compiled into a reusable artifact.

Automated tests and curated replay evidence exercise a simulated operator in the same live session and verify assisted success. A real-person session was opened but timed out without completed resume. The README provides the exact manual demonstration commands; the evidence does not mislabel the simulation as human activity.

# Safety

Policy is enforced in code against origins/routes, action classes, actual control attributes, and allowed control names. Artifacts/model responses cannot grant permissions. Transfers and unknown controls are blocked. Request interception covers the demo's navigation and subrequests; service workers, WebSockets, and additional windows are blocked or rejected. This is not an OS/network sandbox or a proof that arbitrary hostile websites are safe. Unknown dialogs are dismissed and execution stopped.

Only fictional data is used. Credentials remain in ignored `.env`; request headers and raw provider errors are never logged. Persisted events contain operational codes/counts, and failure snapshots contain structure without raw page text. Returned balances appear only at the caller boundary. Provider observations contain synthetic page data; deployment against actual regulated records would require an additional redaction/authorization boundary. Operator URLs are local bearer links excluded from evidence. Free-tier billing remained disabled; no paid fallback was enabled.

# Cuts

No distributed workers, production authentication, database, desktop implementation, visual-only targeting, cross-tenant deployment, unrestricted workflow language, or model-assisted replay. The capability and condition profile deliberately implement one complete read-only workflow. A formal approval catalog, per-tenant overrides, stronger content-aware failure screenshots, and durable session recovery are next steps. A real manual walkthrough remains a useful final reviewer check; genuine discovery and model-free replay are already evidenced. Publishing the repository and emailing its link are separate user actions and have not been performed.
