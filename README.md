# Capability Lab

An LLM learns a member lookup through a real browser. The resulting typed capability replays with new inputs without calling a model. The local target is a fictional, server-rendered banking application with no automation-only test IDs.

**Verified:** a genuine Gemini 3.5 Flash Lite discovery produced `capabilities/savings.json` in five API requests. That unchanged artifact returned another member's balance and handled missing members/accounts, ambiguous accounts, slow loading, unknown state, and a simulated operator takeover. See [evidence](evidence/README.md). A subsequent user-operated login and verification handoff also completed successfully; its original sanitized logs are preserved in [human-login evidence](evidence/human-login/summary.json).

## Setup

Requires Node.js 22+ and a Chromium installation:

```sh
npm ci
npx playwright install chromium
npm run check
npm test
```

No model key is required for tests or replay. All account data is fictional. This project is a take-home demonstration, not a production banking integration.

## Start with the saved capability — no model calls

Terminal 1:

```sh
npm run demo
```

Terminal 2:

```sh
npm run replay -- 67890 capabilities/savings.json
npm run replay -- 99999 capabilities/savings.json
```

The first returns the fictional balance `2450.75 USD`; the second returns the business outcome `MEMBER_NOT_FOUND`. Inputs are five-character strings so leading zeros are preserved. The application also has member `11111` without savings and `22222` with ambiguous savings accounts.

Run all seven evidence scenarios, with an isolated local server per scenario:

```sh
npm run verify:capability
```

This executes the checked-in **genuinely discovered artifact**, uses no model, and refreshes the replay evidence. The handoff scenario uses an explicitly simulated operator. The original live discovery events are preserved.

## Discover a new capability

Copy `.env.example` to `.env`, and set `GEMINI_API_KEY` and `GEMINI_MODEL`. Use an AI Studio free-tier project with paid billing disabled for zero spending. The model name alone does not determine billing. Keep `.env` out of Git.

With the demo already running:

```sh
npm run discover -- 12345 capabilities/new-savings.json
npm run replay -- 67890 capabilities/new-savings.json
```

Discovery receives a natural-language goal and live page observations. It chooses individual controls, not a prewritten action sequence. Configure the goal with `GOAL` and target with `DEMO_URL`:

```sh
GOAL="Look up the requested member and read their current savings balance and currency" DEMO_URL=http://127.0.0.1:4173 npm run discover -- 12345 capabilities/new-savings.json
```

The supported capability contract is specifically the savings lookup; arbitrary banking workflows are outside this slice. Discovery records successful UI actions and verifies completion deterministically after each action. The builder adds an authored extraction/condition contract; it does not claim to have learned error states that were never encountered. A successful lookup normally takes five model requests.

The saved artifact contains parameter bindings, typed output declarations, explicit extraction targets, step checkpoints, a versioned application condition profile, and discovery provenance. Replay imports an `ExecutionSurface` interface rather than Playwright or a model client. The browser adapter enforces the actual control policy and rejects ambiguous matches.

## Request controls and cost

Defaults: six total API dispatches per run, 15 seconds between request starts, no automatic retries, and a 30-second per-request timeout including body consumption. Change these with `MODEL_MAX_CALLS`, `MODEL_MIN_INTERVAL_MS`, `MODEL_MAX_RETRIES`, and `MODEL_TIMEOUT_MS`. Optional 502/503/504 retries consume the same budget. A 429 or transport failure stops the run.

Budgets are per process/run; they are not a project-wide quota tracker. Check your account's limits before a live run. Logs retain HTTP status, a derived quota scope when available, and bounded retry delay; they omit raw provider messages and credentials. Historical `FREE_QUOTA_EXHAUSTED` events were overly broad and do not prove daily quota exhaustion.

Tests mock model responses. They never load `.env` or send live model requests. The included development artifact is labelled `development-fixture` and is not used to claim genuine discovery.

## Human takeover

Use a separate demo port so the normal demo can remain running:

```sh
PORT=4174 SCENARIO=auth npm run demo
```

In another terminal:

```sh
DEMO_URL=http://127.0.0.1:4174 HEADED=1 npm run replay -- 12345 capabilities/savings.json
```

The headed browser stops at “Session expired.” Open the local operator URL printed in the terminal. In the **same banking window**, click “Restore demo session,” then Resume in the operator page. No real credentials are involved. The operator page shows the run, step, capability, and reason. Premature or duplicate resume is rejected; cancellation and a five-minute timeout are supported. Automation verifies the resulting state before proceeding. The local operator link grants control and must not be published.

Control events and manual click/change/submit/navigation event types are recorded without entered values. The operator controls a trusted local window; browser-chrome/OS actions and enforcement against someone directly clicking during automation are outside this minimal mechanism.

## Safety, errors, and evidence

`POLICY_FILE` can load a validated JSON policy; see `src/policy.ts`. Routes and actual controls are checked independently of model instructions. Transfers and unknown actions are blocked. Browser requests outside the allowed origin/routes, WebSockets, service workers, and new windows are blocked or rejected. This is not a full network sandbox.

Member-not-found, no savings account, and ambiguous accounts are business outcomes, checked against the correct screen/member. Loading is bounded; dispatched clicks are never blindly retried. Unknown states return structured failures or request bounded intervention when running headed. Assisted discoveries are not published as unattended capabilities because manual steps are not compiled.

CLI runs write sanitized JSONL events under ignored `runs/`. Rich failure evidence is a structural DOM snapshot containing tags and roles, without raw text or field values. Sensitive outputs go to the invoking terminal, not persisted event logs. Only fictional page data is sent to the provider; using real regulated data would need additional observation redaction and deployment controls.

The detailed design is in `ARCHITECTURE.md`; the implemented design and deliberate cuts are in `REPORT.md`. No remote publication or push has been performed.

API references: [Playwright contexts](https://playwright.dev/docs/api/class-browsercontext), [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output), [Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits).

## Staff login and verification demo

This local, fictional staff portal now offers a username/password screen and a second verification-code screen. Automation pauses while you authenticate in its existing browser. The original saved capability remains unchanged; replay makes no model calls.

In one terminal, from the project directory:

```sh
PORT=4175 SCENARIO=login npm run demo
```

In another terminal:

```sh
DEMO_URL=http://127.0.0.1:4175 HEADED=1 npm run replay -- 12345 capabilities/savings.json
```

1. In the banking window, enter username **demo.teller** and password **DemoBank!2026**, then click **Sign in**.
2. Enter demo code **482916**, then click **Verify and continue**. Leave the banking window on Member services.
3. Open the printed Operator URL in a separate, regular browser window. Click **Resume**. The saved workflow retrieves the balance.

The handoff allows five minutes; each verification challenge lasts two minutes. Wrong credentials/codes show errors. Three incorrect passwords impose a 30-second cooldown for that session; three incorrect codes require restarting sign-in. Early Resume keeps automation paused and offers Resume/Cancel again. Cancel or expiry ends the run. Interactive runs have a 15-minute overall deadline.

For an additional interruption while opening the account, stop this demo server and restart it with `SCENARIO=login-expiry`. Run the same replay command: authenticate at entry, resume, then authenticate and resume a second time at the account screen. Each interruption prints a new Operator URL.

Sessions use opaque, server-held state and HttpOnly, SameSite cookies. Credentials and codes are submitted by POST and are excluded from event logs. The fixed code is a simulation, not a real second factor: no authenticator integration, SMS, or email is involved. This localhost HTTP demo does not implement production banking authentication; accounts and session state are in memory and reset with the server. The original `normal` and `auth` scenarios remain available for reproducible prior evidence.

## One capability across two institutions

`npm run verify:tenants` starts both local variants, runs the original discovered artifact for two members at each, checks outputs, and saves sanitized evidence under `evidence/tenant-reuse/`. It needs no model key and leaves the capability unchanged.

Harbor uses the original labels and a description list. Summit uses Customer directory / Customer number / Find customer / View customer / Savings deposit, and an account table with different field attributes. The schema-validated JSON profiles in `profiles/` map known vendor locator slots to these differences. These mappings are authored configuration, not newly learned behavior. Routes and business rules are shared in this stage; this does not demonstrate frames, desktop access, or arbitrary vendor compatibility.

To watch Summit, start its server:

```sh
PORT=4176 TENANT=summit npm run demo
```

Then run in another terminal:

```sh
PROFILE_FILE=profiles/summit.json HEADED=1 npm run replay -- 67890 capabilities/savings.json
```

If `.env` defines `DEMO_URL`, set `DEMO_URL=http://127.0.0.1:4176` on that replay command; the explicit URL overrides the profile default. Add `SCENARIO=login` to the server command to combine Summit with human login.

Page markers must match the selected tenant and supported layout version. A wrong tenant or unknown layout stops before workflow actions. Profiles cannot contain steps, permissions, or route overrides; deployment policy remains authoritative after label translation. Label/role targets must still resolve uniquely, and outputs still require matching member/account identity. Profile and artifact digests in new run events hash their JSON serialization; the tenant evidence manifest additionally hashes the exact artifact file bytes.

## Operator dashboard

Every `HEADED=1` CLI run now prints a **Dashboard URL** before opening the banking window. Open it in your regular browser, separately from the automated banking window. It shows the institution, capability, completed/current steps, control state, and final outcome. Step labels summarize the saved actions; discovery does not have a prerecorded step list.

When authentication blocks progress, the dashboard explains whether sign-in or verification is needed. Complete that in the banking window, then click **Resume on the dashboard**. The same session validator handles this action; premature Resume keeps the run paused. Cancel is available while awaiting human intervention. Controls are disabled while automation or validation owns the session. The original Operator URL still works as a minimal handoff page, but the dashboard stays the same across multiple interventions.

The final status remains available for 60 seconds after completion, then the command exits. Financial outputs remain in the invoking terminal; they are not added to the dashboard or logs. The dashboard URL grants local operator control and should not be shared. No additional model calls are involved.

The final requirement-by-requirement review, validation, and scope limits are recorded in [REVIEW.md](REVIEW.md).
