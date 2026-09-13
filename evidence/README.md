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

The simulated operator is explicitly labelled. A real-person handoff session timed out; there is no claim that a person completed the recorded successful handoff. The mechanism itself uses real browser state and an actual operator HTTP endpoint, not a mocked session.

Run `npm run verify:capability` to reproduce the seven replays without a model key. It preserves the original discovery evidence and updates replay logs/manifest. This command launches local servers itself. The checked-in capability also replays directly with the README commands.

Raw model payloads, typed input values, credentials, live operator URLs, and financial outputs are excluded from event files. Error snapshots preserve tags/roles only. Tests compare returned outputs in memory before storing `output_checked: true`. Ignored `development/` logs come from test fixtures and are not submission discovery evidence.
