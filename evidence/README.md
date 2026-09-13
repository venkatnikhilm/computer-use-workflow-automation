# Evidence

The live discovery used Gemini 3.5 Flash Lite against the local fictional banking UI. It completed five UI actions in five successful API requests. Its original run ID is recorded in `discovery/capability.json`; `discovery/events.jsonl` contains the actual sanitized request/action events. No mocked provider produced this artifact.

`manifest.json` binds seven replay runs to the exact artifact SHA-256. Every replay used `capabilities/savings.json` unchanged and made zero model calls:

| Directory | Verified behavior |
|---|---|
| `different-member` | New input returns the expected balance and currency |
| `member-not-found` | Structured `MEMBER_NOT_FOUND` business outcome |
| `no-savings` | Structured `NO_SAVINGS_ACCOUNT` business outcome |
| `ambiguous-account` | Structured `AMBIGUOUS_ACCOUNT` business outcome |
| `slow-load` | Bounded waiting tolerates delayed search response |
| `unknown-state` | Structured failure and sanitized structural snapshot |
| `simulated-handoff` | Automation yields; a simulated operator acts in the same session; validated resume succeeds |

An additional walkthrough is saved in `human-login/`: a real person completed the fictional staff login and simulated verification code, then resumed automation. Its original events show authentication intervention, manual actions, validated resume, all five workflow steps, and assisted success with zero model calls. The user confirmed operating this run. Its separate summary hashes the preserved event file; unlike the seven harness runs, the manual run did not record an artifact digest. The simulated-operator evidence remains separately labeled. Re-running the seven-scenario harness does not replace this manual evidence.

Run `npm run verify:capability` to reproduce the seven replays without a model key. It preserves the original discovery evidence and updates replay logs/manifest. This command launches local servers itself. The checked-in capability also replays directly with the README commands.

Raw model payloads, typed input values, credentials, live operator URLs, and financial outputs are excluded from event files. Error snapshots preserve tags/roles only. Tests compare returned outputs in memory before storing `output_checked: true`. Ignored `development/` logs come from test fixtures and are not submission discovery evidence.

`tenant-reuse/` additionally contains four browser replays: two distinct members at each of Harbor and Summit, using identical saved capability bytes. Run `npm run verify:tenants` to reproduce them without model calls. Profiles are authored mappings; the manifest records the exact artifact hash and each profile digest. These runs do not replace the original discovery or human-login evidence.

`legacy/` contains a successful unchanged-artifact replay inside a same-origin iframe and a deliberate ambiguous-field failure. The failure snapshot includes resolution phase and match count. Reproduce with `npm run verify:legacy`; the mappings are authored and these runs make no model calls. Historical discovery and prior evidence are retained unchanged.
