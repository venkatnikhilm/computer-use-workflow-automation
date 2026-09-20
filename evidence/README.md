# Evidence

The live discovery used Gemini 3.5 Flash Lite against the local fictional banking UI. It completed five UI actions in five successful API requests. Its original run ID is recorded in `discovery/capability.json`; `discovery/events.jsonl` contains the actual sanitized request/action events. No mocked provider produced this artifact.

`manifest.json` binds seven replay runs to the exact artifact SHA-256. Every replay used `capabilities/savings.json` unchanged and made zero model calls:

| Directory           | Verified behavior                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------- |
| `different-member`  | New input returns the expected balance and currency                                         |
| `member-not-found`  | Structured `MEMBER_NOT_FOUND` business outcome                                              |
| `no-savings`        | Structured `NO_SAVINGS_ACCOUNT` business outcome                                            |
| `ambiguous-account` | Structured `AMBIGUOUS_ACCOUNT` business outcome                                             |
| `slow-load`         | Bounded waiting tolerates delayed search response                                           |
| `unknown-state`     | Structured failure and sanitized structural snapshot                                        |
| `simulated-handoff` | Automation yields; a simulated operator acts in the same session; validated resume succeeds |

An additional walkthrough is saved in `human-login/`: a real person completed the fictional staff login and simulated verification code, then resumed automation. Its original events show authentication intervention, manual actions, validated resume, all five workflow steps, and assisted success with zero model calls. The user confirmed operating this run. Its separate summary hashes the preserved event file; unlike the seven harness runs, the manual run did not record an artifact digest. The simulated-operator evidence remains separately labeled. Re-running the seven-scenario harness does not replace this manual evidence.

Run `npm run verify:capability` to reproduce the seven replays without a model key. It preserves the original discovery evidence and updates replay logs/manifest. This command launches local servers itself. The checked-in capability also replays directly with the README commands.

Raw model payloads, typed input values, credentials, live operator URLs, and financial outputs are excluded from event files. Error snapshots preserve tags/roles only. Tests compare returned outputs in memory before storing `output_checked: true`. Ignored `development/` logs come from test fixtures and are not submission discovery evidence.

`tenant-reuse/` additionally contains four browser replays: two distinct members at each of Harbor and Summit, using identical saved capability bytes. Run `npm run verify:tenants` to reproduce them without model calls. Profiles are authored mappings; the manifest records the exact artifact hash and each profile digest. These runs do not replace the original discovery or human-login evidence.

`legacy/` contains a successful unchanged-artifact replay inside a same-origin iframe and a deliberate ambiguous-field failure. The failure snapshot includes resolution phase and match count. Reproduce with `npm run verify:legacy`; the mappings are authored and these runs make no model calls. Historical discovery and prior evidence are retained unchanged.

## Version-2 contact workflow

`contact-v2/discovery/` preserves the original Gemini discovery events and exact emitted artifact: four successful API requests and four verified actions. `contact-v2/original-replay/` preserves the immediately subsequent user-invoked replay, bound by its artifact digest, with unattended success and zero model calls. The user supplied terminal commands showing the changed input and returned contact details; persisted logs intentionally omit those values. Its summary does not claim independent output comparison.

Run `npm run verify:contact` for independent reproduction with no key or manually started server. It checks the original discovery provenance and task digest, disables Node provider requests, and replays the unchanged discovered contact artifact for two known members and a missing member at each bank layout. All three output fields are compared in memory. The six sanitized runs and an exact artifact SHA-256 manifest are written under `contact-v2/replays/` and `contact-v2/manifest.json`; the original discovery and user-run replay are not overwritten.

`capabilities/examples/*.v2.json` remain explicitly labeled development fixtures. `npm run verify:workflows` exercises those fixtures with real browsers and no provider calls; those runs do not substitute for the contact live-discovery evidence.

## Agent-facing capability interface

`capability-api/` records an actual HTTP catalog lookup followed by a named invocation of the genuinely discovered contact artifact. The verifier checks all returned contact fields in memory and saves sanitized events, the public typed catalog, and a summary binding the artifact digest to the run. It blocks Node requests to any destination except the local API. No LLM caller or model decision is claimed: this demonstrates an interface that an agent could discover and call. Reproduce using `npm run verify:api`; no manually started server or API key is needed.

## Cross-application verification

`generalization/` records an independent inventory application using the same runner. Discovery decisions are simulated and the generated stock artifact is labeled `development-fixture`. Four replays succeed across two items and two label variants; missing items and ambiguous controls produce their expected outcomes. `npm run verify:generalization` regenerates the fixture and sanitized evidence with no model calls. This does not replace genuine banking discovery evidence.
