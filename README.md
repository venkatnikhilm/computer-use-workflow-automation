# Capability Lab

A local browser-automation prototype: discover a savings-balance lookup through a model, save typed instructions, and replay them without model calls.

**Status:** browser replay and automated same-session handoff tests are implemented. The free-tier API key is configured and a small provider request succeeded, but live discovery attempts received HTTP 503, including bounded retries. Genuine discovery evidence remains pending provider availability. `capabilities/development.json` is hand-authored test input, not LLM-generated evidence. This is an initial implementation, not a finished assignment submission.

## Setup

Requires Node.js 22+.

```sh
npm ci
npx playwright install chromium
npm run check
npm test
```

## Run without model services

Start the fictional banking app in one terminal:

```sh
npm run demo
```

In another terminal:

```sh
npm run replay -- 67890 capabilities/development.json
npm run replay -- 99999 capabilities/development.json
npm run replay -- 11111 capabilities/development.json
npm run replay -- 22222 capabilities/development.json
```

The results are success, member not found, no savings account, and ambiguous savings account respectively. All values are fictional. Outputs appear in the invoking terminal; persisted events omit member IDs and balances.

## Genuine discovery and replay

Copy `.env.example` to `.env` and configure `GEMINI_API_KEY` and `GEMINI_MODEL`. Use an AI Studio **free-tier project without paid billing**, in accordance with the zero-spend constraint. The program does not enable billing, change providers, or fall back to a paid model. A model name alone does not guarantee free usage: billing is determined by the API project. Quota/API failures stop the run.

```sh
npm run discover -- 12345 capabilities/savings.json
npm run replay -- 67890 capabilities/savings.json
```

The model sees current synthetic page observations and chooses the controls. It is not given a prewritten action sequence. Successful actions become the artifact; final account/member identity and output validation are authored application checks. Live discovery has been attempted but has not completed successfully (provider HTTP 503). Do not label development fixtures as discovery evidence.

## Model request controls

No live model requests are part of `npm test`. Tests inject mocked responses and a fake clock; the integration test also mocks the provider.

Defaults are six total dispatched requests per discovery run, at least 15 seconds between request starts, zero automatic retries, and a 30-second timeout per request including reading its body. Optional retries for HTTP 502/503/504 consume the same total budget and obey pacing. HTTP 429 stops immediately and is never automatically retried. Transport failures stop as well. Pacing happens before the request timeout starts.

Configure `MODEL_MAX_CALLS`, `MODEL_MIN_INTERVAL_MS`, `MODEL_MAX_RETRIES`, and `MODEL_TIMEOUT_MS` in `.env`. These are **per-process/run safeguards**, not a project-wide quota tracker: restarting or running multiple processes creates independent budgets. Fifteen seconds is a conservative starting interval, not a claim that it matches your account's rate limit. Check AI Studio before another live attempt.

Events count every dispatch, including failures and retries. Rate-limit diagnostics retain only HTTP status, a derived quota scope (`per_minute`, `per_day`, `mixed`, or `unknown`), and a bounded retry delay when available. Raw provider messages, quota IDs, project identifiers and credentials are discarded. `MODEL_RATE_LIMITED` does not assert that the daily quota is exhausted. Older logs with `FREE_QUOTA_EXHAUSTED` used an overly broad classification and cannot establish which limit was reached.

## Human takeover

Stop the demo server, then restart it with an authentication blocker:

```sh
SCENARIO=auth npm run demo
```

Run a visible session:

```sh
HEADED=1 npm run replay -- 12345 capabilities/development.json
```

When paused, the terminal prints a local operator URL. Open it manually. In the **existing banking browser**, click “Restore demo session,” then click Resume in the operator page. No real credentials are needed. Premature resume returns a conflict. Automation checks identity and extracts the balance after the handoff. Cancel and a two-minute intervention timeout are supported. The operator URL grants local control and is not persisted in evidence.

`npm test` exercises this mechanism using a **simulated operator** acting through the same browser. Those test logs are not evidence that a real person performed takeover.

Other scenarios: `SCENARIO=slow` and `SCENARIO=unknown` when starting the demo. Scenario selection is server configuration, not an agent-accessible shortcut.

## Evidence and limits

CLI events and structural failure snapshots go under ignored `runs/<run-id>/`. Test evidence goes under `evidence/development/`. Its README identifies the provenance. Screenshots and raw DOM text are intentionally not persisted; structural failure snapshots contain tags and roles. Recorded manual actions contain event types, not entered values.

The interpreter currently supports `click` and parameter-bound `fill`, with serialized navigation/field postconditions, authored output extraction, and a fixed application condition profile. It does not yet serialize arbitrary conditions, tenant overrides, or extraction targets. A JSON policy override can be supplied with `POLICY_FILE`; its schema is in `src/policy.ts`. The browser wrapper is the current surface boundary; a general adapter interface is future work. Auth blockers, unavailable controls before dispatch, and unmet final checkpoints support bounded intervention. Discovery also escalates repeated failure/no progress; assisted discoveries require a fresh recording because manual steps are not compiled into the artifact. Other unknown states return failure. These are explicit remaining gaps against the broader architecture.

References used for API implementation: [Playwright browser contexts](https://playwright.dev/docs/api/class-browsercontext), [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output), and [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing).
