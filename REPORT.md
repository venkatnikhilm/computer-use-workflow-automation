# Architecture

Implementation status: initial prototype, not submission-ready. One TypeScript process controls a local Chromium session through Playwright. A separate demo server serves fictional banking screens. Discovery selects actions with Gemini; replay executes a validated artifact without importing discovery. Both paths share browser policy and outcome checks. Model calls use the user's free-tier project only; no paid fallback is configured.

The initial implementation uses simple modules rather than reproducing the service architecture of another project. `ARCHITECTURE.md` remains the broader target design; this report describes what exists.

# Artifact schema

Zod validates a versioned JSON capability with typed member input, monetary/currency outputs, ordered click/fill steps with serialized path/field postconditions, target descriptors, a named completion rule, condition-profile version, and provenance. Fills reference `member_id` explicitly instead of persisting invocation values. Artifacts distinguish development fixtures from LLM discoveries. Discovery stores only executed steps after final verification.

Current schema is intentionally limited to the banking lookup. Conditions/extraction are named contracts implemented in code rather than a general declarative language. Independent different-input replay of a genuinely generated artifact is still required before claiming reusable discovery.

# Determinism & error handling

Replay uses exact labels, roles, or CSS; it requires a single visible enabled match. Clicks wait for navigation within a finite timeout, and fills verify the resulting value. Final validation checks member identity, savings account kind, decimal formatting, and supported currency. Missing member, missing savings account, and multiple savings accounts are business outcomes. Slow navigation is covered by bounded waiting. There are no blind action retries or model repairs. Discovery separately limits total API dispatches (six by default), spaces them by at least 15 seconds, and disables provider retries by default. HTTP 429 stops immediately; sanitized diagnostics distinguish a quota scope only when provider details support it. Tests use mocked responses and fake time for these controls.

Tests execute real Chromium and verify different inputs, expected business outcomes, unknown-state failure, policy rejection, output exclusion from logs, and session takeover. Development evidence is explicitly labelled; genuine model evidence remains pending: the configured free-tier key passed a small request, but discovery received HTTP 503 even after bounded retries.

# Heterogeneity & multi-tenant

Browser perception and control live in `Surface`, separate from the interpreter. This is a first boundary, not implemented desktop portability: locator types and completion checks are currently web/application-specific. A future adapter interface and declarative conditions would allow desktop accessibility targeting and scoped frame paths. Application identity is checked via a demo version marker. Tenant profiles, locator overrides, and compatibility digests remain future work.

# Escalation & handoff

An authentication blocker pauses automation and exposes a localhost operator page with Resume/Cancel. The person operates the same headed browser. The session rejects automation actions during human ownership; a resume transitions through validation. Premature resume is rejected. Capture-phase event instrumentation records click/change/submit event types without values. A two-minute timeout bounds intervention. Direct local browser access is a trusted-operator boundary; OS and browser-chrome actions are not captured.

The automated handoff test simulates the operator and verifies same-page identity, premature resume rejection, action capture, and assisted success. A manual demonstration remains pending. Repeated discovery failures and lack of progress also request intervention. Assisted discovery cannot publish a reusable artifact because manual steps are not compiled; it requires rerecording. Replay can retry an unavailable target after a validated pre-dispatch handoff, or accept a human-completed final checkpoint. It never retries uncertain dispatched clicks.

# Safety

The browser context blocks requests outside permitted local origins/routes, blocks service workers and WebSockets, and rejects new windows. A validated JSON policy can configure permitted routes/actions and control names. Actual control attributes are checked before actions; transfers are blocked independently of the model. Unexpected dialogs are dismissed and the run stopped, which is intentionally conservative for this read-only demo. Browser interception is not a general network sandbox.

Events persist fixed operational fields without raw input/output values or model payloads. Failure snapshots retain structural tags/roles only. The current model observes synthetic demo data; this observation path is not suitable for unredacted real financial data. The local authentication cookie is a demo mechanism, not production authentication.

# Cuts

No database, distributed workers, real bank access, production authentication, desktop implementation, tenant overrides, arbitrary scripts, or model-assisted replay. Still required for a complete submission: genuine discovery evidence; validation of its generated artifact with new inputs; stronger serialized conditions and broader portability; and a real manual takeover demonstration. These gaps are tracked explicitly rather than represented as complete features.
