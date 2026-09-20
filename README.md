# Computer-use workflow automation

Learn a workflow through an AI-driven browser run, save its verified actions as a typed capability, and replay it for new inputs without further model decisions.

The target is a local, fictional banking staff application. Two genuinely discovered workflows are demonstrated: **read a savings balance** and **retrieve member contact details**. Automation checks identity and policy, returns structured outcomes, and can pause for a person to take over the same browser session.

```text
Goal + task definition → AI observes and acts → verified capability file
Capability + new inputs → deterministic browser execution → checked result
                                      ↓ blocker
                              human takeover → validate → resume
```

## Start here

**Yes—please run the verification commands.** They exercise real browser interactions, require no API key, and start their own local servers. Repeating live AI discovery is optional and consumes provider quota.

| What you want to do              | Where to start                                                        |
| -------------------------------- | --------------------------------------------------------------------- |
| Install and check the submission | [Setup and automated verification](#setup-and-automated-verification) |
| Run a saved workflow yourself    | [Interactive use](#run-a-saved-workflow-yourself)                     |
| Watch login and human takeover   | [Human handoff](#watch-login-and-human-handoff)                       |
| Repeat AI discovery              | [Optional discovery](#optional-repeat-ai-discovery)                   |
| Inspect the design and proof     | [REPORT.md](REPORT.md) and [evidence/README.md](evidence/README.md)   |

## Setup and automated verification

Prerequisites: **Node.js 22+**, npm (included with Node), Git, and enough permissions to launch Chromium and listen on localhost. Installation needs internet access to download dependencies and Chromium. Tests and replay need no model credentials or external banking service.

```sh
git clone https://github.com/venkatnikhilm/computer-use-workflow-automation.git
cd computer-use-workflow-automation
node --version
npm ci
npx playwright install chromium
```

If you received a source archive, extract it and open a terminal in the directory containing `package.json` instead of cloning. On Linux, if Chromium reports missing system libraries, use `npx playwright install --with-deps chromium` (system-package installation may request administrator permission).

**Recommended reviewer checks:**

```sh
npm run check
npm test
npm run verify:contact
npm run verify:capability
```

Expected results:

- `check`: TypeScript validation succeeds without errors.
- `test`: all 82 tests pass, including browser execution, policy, identity checks, authentication, and handoff. Test decisions/operators are simulated where explicitly indicated.
- `verify:contact`: six runs of the genuinely discovered contact artifact across two bank layouts. Four succeed; two return the expected `MEMBER_NOT_FOUND` business outcome. All use zero model calls.
- `verify:capability`: seven runs of the genuinely discovered savings artifact, including missing records/accounts, ambiguous accounts, slow responses, an intentional unknown-state failure, and simulated human takeover. The command exits successfully when every expected result matches.

No demo server or `.env` is needed for these checks. Browsers run headlessly; the harness closes its servers and browsers on completion. A localhost Operator URL printed during a test is handled by the simulated operator—you do not need to open it. Verification scripts refresh their corresponding evidence directories, so a dirty Git working tree afterward is expected. Original contact discovery and original user-run replay logs are preserved separately.

For additional coverage:

| Command                    | What it checks                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `npm run verify:workflows` | Eight runs: two development fixtures × two members × two layouts; model requests disabled                  |
| `npm run verify:tenants`   | Original discovered savings artifact reused across Harbor and Summit                                       |
| `npm run verify:legacy`    | Same savings artifact inside a legacy iframe; duplicate controls deliberately fail with `AMBIGUOUS_TARGET` |

A printed `failure` in an intentional failure scenario is expected. A nonzero verifier exit code or assertion error means verification did not pass.

## Two optional stretch goals

This submission implements **cross-tenant reuse** and an **agent-facing capability interface**. The tenant verifiers demonstrate reuse of unchanged artifacts with per-layout mappings. The HTTP interface lets a program or agent discover typed capability descriptions and invoke a registered workflow by name.

Run the API demonstration with no key or manually started server:

```sh
npm run verify:api
```

Expected: `Catalog discovery: success`, followed by `get_member_contact via HTTP: success, typed outputs checked, zero model calls`. This programmatic caller lists the catalog, selects the contact capability, invokes it, and checks the returned fields. It demonstrates the callable interface; it does not claim that an LLM selected the tool. Sanitized proof is saved in [API evidence](evidence/capability-api/summary.json).

To try the API manually, start the normal demo in Terminal 1:

```sh
PORT=4180 npm run demo
```

In Terminal 2:

```sh
DEMO_URL=http://127.0.0.1:4180 API_PORT=4182 npm run api
```

Copy the freshly printed bearer token into Terminal 3 (the token changes on every API restart):

```sh
export CAPABILITY_TOKEN='paste-the-token-here'
curl -s http://127.0.0.1:4182/capabilities \
  -H "Authorization: Bearer $CAPABILITY_TOKEN"
curl -s http://127.0.0.1:4182/capabilities/get_member_contact/invoke \
  -H "Authorization: Bearer $CAPABILITY_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"arguments":{"customer_ref":"67890"}}'
```

The catalog contains `get_member_contact` and `get_savings_balance`, each with a description, version, artifact digest, and JSON input/output schemas. Inputs are required strings; unknown fields are rejected. Invocation returns `status`, `run_id`, and either typed `outputs` or an outcome/error code. For savings, use `/capabilities/get_savings_balance/invoke` and `{"arguments":{"member_id":"67890"}}`.

HTTP 200 means execution returned a structured result: inspect `status` to distinguish success, a business outcome, and execution failure. Request errors use 400 (invalid arguments), 401 (access rejected), 404 (unknown capability), 409 (another run is active), 413 (body too large), or 415 (JSON required). Unexpected API errors use 500 without internal exception text.

The API binds to localhost, requires its generated token, rejects browser-origin requests, and executes one invocation at a time. It uses a fresh headless browser for each request and always closes it. Browser authentication blockers return `INTERVENTION_REQUIRED`; use the headed CLI for human handoff. Requests cannot change artifact files, the application URL, tenant settings, or policy. Artifacts are loaded at startup; restart to load updated files. This is a synchronous local interface, not a durable job service or production multi-user API. An HTTP disconnect does not cancel a run: do not automatically retry an uncertain invocation. Outputs are returned only to the authenticated caller and are excluded from event logs. Stop both servers with Ctrl+C when finished.

## Run a saved workflow yourself

Keep the server running in **Terminal 1**:

```sh
PORT=4180 npm run demo
```

In **Terminal 2**, from the same project directory:

```sh
DEMO_URL=http://127.0.0.1:4180 HEADED=0 npm run replay -- capabilities/contact.discovered.v2.json '{"customer_ref":"67890"}'
```

Expected result:

```json
{
  "status": "success",
  "outputs": {
    "email": "jordan@example.test",
    "phone": "202-555-0182",
    "membership_status": "active"
  },
  "assisted": false
}
```

The AI originally discovered this workflow using a different member. This invocation runs the saved artifact with **zero model calls**. Change `HEADED=0` to `HEADED=1` to watch the browser and receive a separate dashboard URL.

Try the original savings capability against the same server:

```sh
DEMO_URL=http://127.0.0.1:4180 HEADED=0 npm run replay -- capabilities/savings.json '{"member_id":"67890"}'
DEMO_URL=http://127.0.0.1:4180 HEADED=0 npm run replay -- capabilities/savings.json '{"member_id":"99999"}'
```

The first returns `2450.75` and `USD`. The second returns `business_outcome` with `MEMBER_NOT_FOUND`. Other fictional members: `12345` has a savings balance of `100.00`; `11111` has no savings account; `22222` has ambiguous savings accounts. Member identifiers are five-character strings, preserving leading zeros.

Stop the server with **Ctrl+C** when finished. CLI replay logs go under ignored `runs/`; output values are returned to the terminal and excluded from persisted events. The contact CLI exits nonzero for failure/cancellation; a business outcome is a valid result.

Commands above use macOS/Linux shell syntax. In PowerShell, set environment variables separately, for example `$env:PORT='4180'; npm run demo` and `$env:DEMO_URL='http://127.0.0.1:4180'` in the replay terminal. Keep the JSON input as one quoted argument.

## What has been verified?

| Artifact                                  | Origin                                               | Demonstrated behavior                                                                                |
| ----------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `capabilities/savings.json`               | Genuine Gemini discovery, five API requests          | Different-input replay, business outcomes, bounded waiting, tenant/legacy reuse, handoff             |
| `capabilities/contact.discovered.v2.json` | Genuine Gemini discovery, four API requests          | User-run different-input replay; automated output checks and missing-member outcomes on both layouts |
| `capabilities/examples/*.v2.json`         | Simulated discovery decisions against a real browser | Both task definitions execute through the same engine; explicitly development fixtures               |

[Contact evidence](evidence/contact-v2/manifest.json) binds the replay runs to the exact artifact hash. Original discovery and user-run replay events are retained under `evidence/contact-v2/`. [Savings evidence](evidence/manifest.json) and the separate [user-operated login evidence](evidence/human-login/summary.json) remain available. Logs intentionally omit input/output values; automated verifiers compare outputs in memory before writing `output_checked: true`.

There is one discovery loop and one replay interpreter. Inputs, outputs, named controls, identity invariants, and outcomes are task data. A small compatibility adapter translates the original savings artifact into the common format in memory; saved artifact bytes and historical discovery evidence remain unchanged. Schema numbers describe file formats, not separate engines. Historical positional CLI calls and `discover:workflow` / `replay:workflow` aliases still delegate to these same entry points.

## Watch login and human handoff

Start a separate authenticated demo in Terminal 1:

```sh
PORT=4181 SCENARIO=login npm run demo
```

Run in Terminal 2:

```sh
DEMO_URL=http://127.0.0.1:4181 HEADED=1 npm run replay -- capabilities/contact.discovered.v2.json '{"customer_ref":"67890"}'
```

1. Open the printed **Dashboard URL** in your regular browser. The automated banking window is a separate window.
2. In the banking window, sign in with username **demo.teller** and password **DemoBank!2026**.
3. Enter the fictional verification code **482916** and click **Verify and continue**. Leave that window on Member services.
4. Click **Resume in the dashboard**. Automation validates the restored session and retrieves the contact details. The result reports `assisted: true`.

Premature Resume leaves the run paused; complete the banking-window steps and retry. Authentication challenges last two minutes; intervention allows five minutes. If either expires, restart the replay to get a fresh session. Cancel is available while awaiting intervention. Dashboard results remain available for 60 seconds after completion before the CLI exits. The Operator URL is an alternative minimal Resume/Cancel page; use the dashboard for the walkthrough.

For a second login interruption midway through the savings workflow, start the server with `SCENARIO=login-expiry` and invoke `npm run replay -- capabilities/savings.json '{"member_id":"12345"}'` with the same `DEMO_URL` and `HEADED=1`. Authenticate and resume at entry, then again when opening the account.

Authentication is a local simulator with a fixed code, not production MFA. Human actions are recorded as event types without typed values. Dashboard/operator URLs are local bearer links and should not be shared.

## Optional: repeat AI discovery

This is the only reviewer path that needs a model key. The checked-in artifacts already demonstrate genuine discovery, so this step is **not required** to test replay or inspect its evidence.

Copy `.env.example` to `.env` only if you do not already have one, then configure `GEMINI_API_KEY` and an available `GEMINI_MODEL`. Never commit the key. For a zero-spending setup, use a provider project with paid billing disabled; a model name alone does not establish billing or quota availability.

With the normal server still running on port 4180:

```sh
DEMO_URL=http://127.0.0.1:4180 HEADED=0 npm run discover -- tasks/member-contact.json '{"customer_ref":"12345"}' capabilities/contact.new.v2.json
DEMO_URL=http://127.0.0.1:4180 HEADED=0 npm run replay -- capabilities/contact.new.v2.json '{"customer_ref":"67890"}'
```

Run the replay only after discovery prints `Saved capabilities/contact.new.v2.json`. Use a new output filename to preserve the submitted artifact. Discovery usually takes about a minute for this task because requests are paced; there may be no intermediate terminal output. Do not start duplicate discovery processes while waiting.

The AI selects the action order from live observations, using declared element keys or exact control descriptors supplied by the observation. Task files contain no prewritten action sequence. Authored task definitions supply field schemas, locators, invariants, exceptional outcomes, and completion assertions; the model does not invent or learn all business semantics from one successful run. Only executed, checked actions enter the artifact. Repeated invalid decisions or lack of progress can request human intervention in headed mode; unattended runs stop with a structured error. Assisted discoveries are rejected because manual steps are not compiled.

To discover the savings task with the same engine:

```sh
DEMO_URL=http://127.0.0.1:4180 HEADED=0 npm run discover -- tasks/savings.json '{"member_id":"12345"}' capabilities/savings.new.json
```

All new discoveries use the common artifact format. The original savings file stays readable through the compatibility adapter.

Defaults are six API attempts, at least 15 seconds between requests, no automatic retries, and a 30-second request timeout. Configure these using `MODEL_MAX_CALLS`, `MODEL_MIN_INTERVAL_MS`, `MODEL_MAX_RETRIES`, and `MODEL_TIMEOUT_MS`. A 429 stops the run; optional transient retries consume the same budget. Limits are per run, not shared across processes.

## Architecture and adding a task

```text
src/workflow-contracts.ts   fields, elements, bindings, and conditions
src/workflow-discovery.ts  model-driven action selection and recording
src/workflow-runtime.ts    deterministic conditions, execution, and extraction
src/discovery.ts           discovery exports and historical call compatibility
src/replay.ts              shared replay entry point
src/compatibility.ts       original-artifact conversion; no execution loop
src/capability-api.ts      typed catalog and named invocation over local HTTP
src/api-cli.ts             API server entry point
src/browser.ts             shared browser mutation gateway and authentication
src/policy.ts              independent deployment permissions
src/profile.ts             tenant mappings and compatibility markers
src/session.ts             same-session handoff and control ownership
src/dashboard.ts           operator progress and Resume/Cancel
src/events.ts              sanitized events and failure snapshots
src/targeting.ts           native and table-neighbor locator resolution
src/perception.ts          observed controls and verified fallback construction
demo/                      fictional banking and independent inventory applications
tasks/                     authored task definitions
capabilities/              discovered artifacts and labeled examples
profiles/                  Harbor, Summit, and legacy locator configuration
tests/                     contract, browser, policy, and handoff checks
scripts/                   reproducible verification harnesses
evidence/                  curated sanitized runs and manifests
```

For another supported read-only task, define required input/output fields, output elements, optional action elements, route-scoped identity checks, outcomes, and completion conditions in a task JSON file. Then discover its action sequence and verify it with different inputs and failure cases. Locator candidates are tried in order: absent controls allow fallback; ambiguous controls stop. Completion verifies business identity, not merely a matching selector.

The contact task uses `customer_ref` rather than the savings task's `member_id`; it returns three contact fields instead of money. A member without savings can still have a successful contact lookup. These differences exercise configuration-driven behavior in the same interpreter.

A new application using the supported HTML controls requires an application profile, independent policy, and task definition. A new control kind, desktop surface, or write operation requires executor changes. Artifacts cannot expand browser permissions. Read [REPORT.md](REPORT.md) for the detailed design and tradeoffs.

## Reuse across different applications

The same discovery loop, replay interpreter, action gateway, and handoff controller also run an independent **inventory application**. It has different routes, records, metadata, input names, and output types. Adding it required configuration and a demo app, with no inventory branch in the runner.

```bash
npm run verify:generalization
```

This starts its own local servers and needs no credentials. It generates a clearly labeled development artifact, then checks four successful replays (two items × two label variants), one expected `ITEM_NOT_FOUND` outcome, and one expected `AMBIGUOUS_TARGET` failure. Assertions determine the command's exit status. Sanitized evidence is saved under `evidence/generalization/`.

The stock task declares output targets and success/business rules, **but no action controls or action sequence**. The observation exposes native labels/roles and conservative table-neighbor descriptors for unlabeled fields. The decision provider selects observed controls; the recorder saves reusable descriptors rather than changing HTML IDs. Replay resolves these deterministically. Duplicate matches stop; inference does not grant permission to submit an action.

Inventory decisions in this verification are simulated. They prove the integration and replay contract, **not a new genuine AI discovery**. The saved banking runs remain the genuine model evidence.

To watch inventory replay, start Terminal 1:

```bash
npm run demo:inventory
```

In Terminal 2:

```bash
DEMO_URL=http://127.0.0.1:4182 PROFILE_FILE=profiles/inventory-east.json POLICY_FILE=profiles/inventory-policy.json HEADED=1 npm run replay -- capabilities/examples/stock.json '{"item_code":"ITEM-B"}'
```

For the second variant, use `TENANT=west npm run demo:inventory` and `PROFILE_FILE=profiles/inventory-west.json`. The artifact stays unchanged. An optional genuine inventory discovery uses the same environment settings with `npm run discover -- tasks/stock.json '{"item_code":"ITEM-A"}' capabilities/stock.discovered.json`; this consumes model quota and has not been run for the submitted inventory fixture.

Application profiles declare identity/version markers, authentication blockers and guidance, and explicit target translations. Policies independently permit routes, GET forms, field names, and button/link labels. Profiles contain no executable code or extra workflow steps. Existing banking profiles are normalized at the configuration boundary.

This is configured generalization across supported browser applications. It does not automatically understand arbitrary websites, infer business rules, or operate desktop software. Table-neighbor inference supports simple table rows; layouts outside those structural assumptions require explicit targets or a new resolver.

## Legacy targeting verification

```bash
npm run verify:targeting
npm run verify:legacy
```

The targeting checks use real Chromium without model calls. They cover explicit and wrapping labels, multiple `aria-labelledby` references, placeholders, titles, nested tables, quoted label text, and changing HTML IDs. For an observed control, discovery can save up to four candidate locators; each alternative must resolve uniquely to the same live node before it is recorded. These candidates are only structural alternatives, not proof that all future layouts are equivalent.

A browser test discovers an inventory workflow using simulated decisions, removes the field's accessible label in a second application instance, and replays for another item using the recorded table relationship. A duplicate-field variant stops before filling. A separate test excludes an ambiguous placeholder from the saved alternatives. Replay logs the selected candidate index and match count without field values.

Replay only falls through when a candidate has zero matches. Multiple matches remain an error, even if another candidate could identify one control. Business identity and completion assertions still apply. These heuristics support the implemented text/search fields and navigation controls; they do not add checkbox, dropdown, desktop, or image-only automation.

## Additional layouts and configuration

The automatic verification commands are the easiest way to exercise these variants. To watch them manually, use matching server and replay settings:

| Variant       | Terminal 1                               | Terminal 2                                                                                                                                      |
| ------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Summit        | `PORT=4176 TENANT=summit npm run demo`   | `DEMO_URL=http://127.0.0.1:4176 PROFILE_FILE=profiles/summit.json HEADED=1 npm run replay -- capabilities/savings.json '{"member_id":"67890"}'` |
| Legacy iframe | `PORT=4177 SCENARIO=legacy npm run demo` | `DEMO_URL=http://127.0.0.1:4177 PROFILE_FILE=profiles/legacy.json HEADED=1 npm run replay -- capabilities/savings.json '{"member_id":"67890"}'` |

Profiles translate known locator slots and enforce tenant/layout markers; they cannot add actions or permissions. The legacy demo includes a named iframe, table layout, and an unlabeled input. Overrides are authored mappings, not automatically discovered portability.

`DEMO_URL` overrides the profile base URL, including when it is set in `.env`. `PROFILE_FILE` selects a tenant profile; `POLICY_FILE` selects a validated deployment policy. Explicit command-line environment assignments override `.env` values. For reproducible reviewer checks, the verification harnesses supply their own configuration and do not need `.env`.

## Troubleshooting

| Symptom                                      | What to do                                                                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EADDRINUSE`                                 | Another server owns that port. Stop your old server with Ctrl+C, or choose another `PORT` and use that same port in `DEMO_URL`.                         |
| Browser executable missing                   | Run `npx playwright install chromium` after `npm ci`.                                                                                                   |
| Connection refused / `RUN_FAILED` at startup | Confirm the demo is running and `DEMO_URL` matches it; inspect the printed sanitized evidence directory.                                                |
| Tenant/version mismatch                      | Restart an older demo server after updating code, and match `PROFILE_FILE` to the running variant.                                                      |
| Resume rejected                              | Complete login and verification in the automated banking window, return to its expected screen, then resume in the dashboard.                           |
| `INTERVENTION_TIMEOUT`                       | Start a fresh replay and finish the login/resume steps within five minutes.                                                                             |
| Discovery is silent                          | Requests are paced and the browser is hidden with `HEADED=0`. Wait for `Saved ...` or a failure; avoid duplicate runs.                                  |
| Model rate limit / HTTP 429                  | Replay and tests remain available without quota. Wait for provider quota recovery; discovery does not enable billing or switch providers automatically. |
| `verify:legacy` prints a failure             | The ambiguous-target scenario is deliberately rejected. Check the verifier exit status rather than interpreting that one line as a test failure.        |

## Scope and limits

- Three read-only tasks across two fictional applications, with authored tenant/layout variants. Banking discovery is genuine; inventory discovery uses a simulated decision provider. No real banking integration or claim of production scale.
- Navigation-based clicks and fills; arbitrary single-page interactions, financial writes, desktop control, and general cross-origin/nested-frame support are outside this implementation.
- Browser requests are restricted by origin/routes; real controls are checked independently of model suggestions. Dispatched clicks are not blindly retried. This is not an OS-level sandbox.
- Failure evidence includes safe routes, execution phase, target counts/actionability, and structural tags/roles. Raw screenshots, page text, inputs, credentials, and output values are omitted from persisted diagnostics.
- Discovery observations contain fictional page data. Real regulated data would require additional provider, authorization, and redaction controls.
- No durable process recovery, distributed workers, formal capability approval service, or model-driven repair during replay.

Tests use simulated model responses and make no live model calls. The CLI integration test loads CLI configuration, including `.env` if present, but runs replay only. The preserved discovery evidence comes from separate genuine model runs.
