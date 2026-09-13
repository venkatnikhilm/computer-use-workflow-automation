import {
  TenantProfile,
  harborProfile,
  resolveProfileTarget,
  digest,
  type Profile,
} from "./profile.js";
import { chromium, Browser, Page, Locator } from "playwright";
import {
  RunError,
  StepType,
  Target,
  Extraction,
  defaultExtraction,
} from "./contracts.js";
import { z } from "zod";
import { Events } from "./events.js";
import { Session } from "./session.js";
import { Policy, defaultPolicy } from "./policy.js";
import type { ExecutionSurface } from "./surface.js";
export class Surface implements ExecutionSurface {
  browser!: Browser;
  page!: Page;
  violation = false;
  readonly deadline: number;
  stepIndex = 0;
  constructor(
    readonly base: string,
    readonly events: Events,
    readonly session: Session,
    readonly policy = defaultPolicy,
    readonly profile: Profile = harborProfile,
  ) {
    this.deadline = Date.now() + (session.interactive ? 900000 : 180000);
    Policy.parse(policy);
    TenantProfile.parse(profile);
    this.session.guidance = async () => {
      if (this.violation || !this.allowed(this.page.url()))
        return "The browser left an allowed destination. Cancel this run and restart.";
      if (
        await this.page
          .getByRole("heading", { name: "Verify your identity", exact: true })
          .count()
      )
        return "Complete verification in the banking window, then return here and click Resume.";
      if (await this.page.locator("[data-auth-required]").count())
        return "Complete sign-in and verification in the banking window. Leave it on the returned screen, then click Resume here.";
      if (
        await this.page
          .getByRole("heading", { name: "Session expired", exact: true })
          .count()
      )
        return "Restore the demo session in the banking window, then click Resume here.";
      const blocker = [...this.events.history]
        .reverse()
        .find((e) => e.type === "intervention");
      if (blocker?.code !== "AUTH_REQUIRED")
        return "Resolve the blocked workflow step in the banking window, then click Resume to validate it. Cancel if it cannot be resolved.";
      return "The login screen is no longer visible. Leave the banking window on the expected workflow screen and click Resume to validate it.";
    };
  }
  allowed(raw: string) {
    try {
      const u = new URL(raw);
      return (
        u.origin === new URL(this.base).origin &&
        this.policy.routes.includes(u.pathname)
      );
    } catch {
      return false;
    }
  }
  async open() {
    this.browser = await chromium.launch({
      headless: process.env.TEST_HEADLESS === "1" || !this.session.interactive,
    });
    const context = await this.browser.newContext({
      serviceWorkers: "block",
      acceptDownloads: false,
    });
    context.setDefaultTimeout(3000);
    await context.route("**/*", async (route) => {
      if (!this.allowed(route.request().url())) {
        this.violation = true;
        await route.abort();
      } else await route.continue();
    });
    await context.routeWebSocket("**/*", (ws) => ws.close());
    await context.exposeBinding("manualEvent", (_source, event: unknown) => {
      if (
        this.session.owner === "human" &&
        ["click", "change", "submit"].includes(String(event))
      )
        this.events.emit("human_action", {
          action: String(event),
          step: this.stepIndex,
        });
    });
    await context.addInitScript(() => {
      for (const type of ["click", "change", "submit"])
        document.addEventListener(
          type,
          () => {
            void (
              window as unknown as { manualEvent: (x: string) => Promise<void> }
            ).manualEvent(type);
          },
          true,
        );
    });
    this.page = await context.newPage();
    this.page.on("dialog", (dialog) => {
      void dialog.dismiss();
      this.violation = true;
    });
    context.on("page", (page) => {
      if (page !== this.page) {
        this.violation = true;
        void page.close();
      }
    });
    this.page.on("framenavigated", () => {
      if (this.session.owner === "human")
        this.events.emit("human_action", {
          action: "navigate",
          step: this.stepIndex,
        });
    });
    await this.page.goto(this.base);
    await this.identity();
    this.events.emit("profile_verified", {
      profile_digest: digest(this.profile),
      tenant_id: this.profile.tenant_id,
    });
  }
  async identity() {
    const markers = [
      ["application", "bank-demo-v1", "INCOMPATIBLE_APP"],
      ["tenant", this.profile.tenant_id, "TENANT_MISMATCH"],
      [
        "layout-version",
        this.profile.layout_version,
        "UNSUPPORTED_APP_VERSION",
      ],
    ];
    for (const [name, expected, code] of markers) {
      const marker = this.page.locator(`meta[name="${name}"]`);
      if (
        (await marker.count()) !== 1 ||
        (await marker.getAttribute("content")) !== expected
      )
        throw new RunError(code!);
    }
  }
  check() {
    this.session.assertAutomation();
    if (Date.now() > this.deadline) throw new RunError("RUN_TIMEOUT");
    if (this.violation || !this.allowed(this.page.url()))
      throw new RunError("POLICY_BLOCKED");
  }
  locator(target: z.infer<typeof Target>): Locator {
    target = resolveProfileTarget(target, this.profile);
    if (target.by === "label")
      return this.page.getByLabel(target.value, { exact: true });
    if (target.by === "role" && target.role)
      return this.page.getByRole(target.role, {
        name: target.value,
        exact: true,
      });
    if (target.by === "css") return this.page.locator(target.value);
    throw new RunError("INVALID_TARGET");
  }
  async conditions(input?: { member_id: string }) {
    this.check();
    const loginRequired =
      (await this.page.locator("[data-auth-required]").count()) > 0;
    if (
      loginRequired ||
      (await this.page
        .getByRole("heading", { name: "Session expired", exact: true })
        .count())
    ) {
      const checkpointURL = this.page.url();
      this.session.step = this.stepIndex;
      await this.evidence();
      await this.session.handoff("AUTH_REQUIRED", async () => {
        if (
          this.violation ||
          !this.allowed(this.page.url()) ||
          this.page.url() !== checkpointURL
        )
          return false;
        await this.identity();
        if (await this.page.locator("[data-auth-required]").count())
          return false;
        if (new URL(checkpointURL).pathname === "/account") {
          if (!input) return false;
          try {
            await this.verifyOutput(input);
            return true;
          } catch {
            return false;
          }
        }
        return (
          loginRequired &&
          (await this.page
            .getByRole("heading", { name: "Session expired", exact: true })
            .count()) === 0
        );
      });
    }
    this.check();
    const current = new URL(this.page.url());
    const path = current.pathname;
    if (
      input &&
      ["/results", "/member", "/account"].includes(path) &&
      current.searchParams.get("member") !== input.member_id
    )
      throw new RunError("IDENTITY_MISMATCH");
    if (
      input &&
      path === "/member" &&
      ((await this.locator(defaultExtraction.member).count()) !== 1 ||
        (await this.locator(defaultExtraction.member).textContent()) !==
          input.member_id)
    )
      throw new RunError("IDENTITY_MISMATCH");
    if (
      path === "/results" &&
      (await this.page
        .getByRole("status")
        .filter({ hasText: /^Member not found$/ })
        .count())
    )
      throw new RunError("MEMBER_NOT_FOUND");
    if (
      path === "/member" &&
      (await this.page
        .getByRole("status")
        .filter({ hasText: /^No savings account$/ })
        .count())
    )
      throw new RunError("NO_SAVINGS_ACCOUNT");
    if (
      path === "/member" &&
      (await this.page
        .getByRole("link", { name: this.profile.labels.savings, exact: true })
        .count()) > 1
    )
      throw new RunError("AMBIGUOUS_ACCOUNT");
  }
  async act(step: StepType, input: { member_id: string }) {
    this.check();
    if (!this.policy.actions.includes(step.action))
      throw new RunError("POLICY_BLOCKED");
    await this.conditions(input);
    const target = this.locator(step.target);
    const count = await target.count();
    if (count !== 1)
      throw new RunError(count ? "AMBIGUOUS_TARGET" : "TARGET_NOT_FOUND");
    if (!(await target.isVisible()) || !(await target.isEnabled()))
      throw new RunError("TARGET_NOT_ACTIONABLE");
    // Independent application policy inspects the actual control, never a model risk label.
    this.check();
    const info = await target.evaluate((el) => ({
      tag: el.tagName,
      name: el.getAttribute("name"),
      text: el.textContent?.trim(),
      href: el.getAttribute("href"),
      action: (el.closest("form") as HTMLFormElement | null)?.getAttribute(
        "action",
      ),
    }));
    const canonicalLabels: Record<string, string> = {
      [this.profile.labels.members]: "Members",
      [this.profile.labels.open_member]: "Open member",
      [this.profile.labels.savings]: "Savings",
      [this.profile.labels.search]: "Search",
    };
    const canonicalText = canonicalLabels[info.text ?? ""] ?? info.text;
    this.check();
    if (step.action === "fill") {
      if (
        info.tag !== "INPUT" ||
        !this.policy.fill_names.includes(info.name ?? "") ||
        !step.input
      )
        throw new RunError("POLICY_BLOCKED");
      await target.fill(input.member_id);
      if ((await target.inputValue()) !== input.member_id)
        throw new RunError("FIELD_NOT_SET");
    } else {
      const safeLink =
        info.tag === "A" &&
        info.href &&
        this.allowed(new URL(info.href, this.base).href) &&
        this.policy.link_labels.includes(canonicalText ?? "");
      const safeSearch =
        info.tag === "BUTTON" &&
        canonicalText === "Search" &&
        info.action === this.policy.search_form;
      if (!safeLink && !safeSearch) throw new RunError("POLICY_BLOCKED");
      const before = this.page.url();
      await target.click();
      await this.page
        .waitForURL((url) => url.href !== before, { timeout: 4000 })
        .catch(() => {
          throw new RunError("POSTCONDITION_TIMEOUT");
        });
      await this.page.waitForLoadState("domcontentloaded");
    }
    this.check();
    await this.identity();
    if (
      step.postcondition?.kind === "path" &&
      new URL(this.page.url()).pathname !== step.postcondition.value
    )
      throw new RunError("CHECKPOINT_MISMATCH");
    // Persist a semantic descriptor of the permitted control, not model-supplied CSS
    // or a selector containing invocation data. The fixed profile supplies safe labels.
    return {
      action: step.action,
      postcondition:
        step.action === "fill"
          ? { kind: "field_equals_input" as const, input: "member_id" as const }
          : { kind: "path" as const, value: new URL(this.page.url()).pathname },
      target:
        step.action === "fill"
          ? { by: "label" as const, value: "Member ID" }
          : {
              by: "role" as const,
              role: info.tag === "A" ? ("link" as const) : ("button" as const),
              value: canonicalText!,
            },
      ...(step.action === "fill" ? { input: "member_id" as const } : {}),
    };
  }
  async complete(input: { member_id: string }, extraction = defaultExtraction) {
    await this.conditions(input);
    return this.verifyOutput(input, extraction);
  }
  async verifyOutput(
    input: { member_id: string },
    extraction = defaultExtraction,
  ) {
    Extraction.parse(extraction);
    if (this.violation || !this.allowed(this.page.url()))
      throw new RunError("POLICY_BLOCKED");
    await this.identity();
    if ((await this.locator(extraction.account_kind).count()) !== 1)
      throw new RunError("COMPLETION_NOT_MET");
    if (
      (await this.locator(extraction.member).textContent()) !==
        input.member_id ||
      (await this.locator(extraction.account_kind).textContent()) !== "savings"
    )
      throw new RunError("IDENTITY_MISMATCH");
    for (const target of [
      extraction.member,
      extraction.account_kind,
      extraction.balance,
      extraction.currency,
    ]) {
      const locator = this.locator(target);
      if ((await locator.count()) !== 1 || !(await locator.isVisible()))
        throw new RunError("OUTPUT_TARGET_INVALID");
    }
    const balance = await this.locator(extraction.balance).textContent();
    const currency = await this.locator(extraction.currency).textContent();
    if (
      !balance ||
      !/^[-]?\d+\.\d{2}$/.test(balance) ||
      !currency ||
      !["USD"].includes(currency)
    )
      throw new RunError("INVALID_OUTPUT");
    return { balance, currency };
  }
  async canResumeAction(step: StepType) {
    const target = this.locator(step.target);
    return (
      !this.violation &&
      this.allowed(this.page.url()) &&
      (await target.count()) === 1 &&
      (await target.isVisible()) &&
      (await target.isEnabled())
    );
  }
  async intervene(code: string, validate: () => Promise<boolean>) {
    await this.evidence();
    this.session.step = this.stepIndex;
    await this.session.handoff(code, validate);
    this.check();
  }
  async observe() {
    return {
      path: new URL(this.page.url()).pathname,
      snapshot: (await this.page.locator("body").ariaSnapshot()).slice(
        0,
        12000,
      ),
    };
  }
  async evidence() {
    try {
      this.events.snapshot(
        await this.page.locator("body").evaluate((el) => ({
          tags: Array.from(el.querySelectorAll("*"))
            .map((x) => ({ tag: x.tagName, role: x.getAttribute("role") }))
            .slice(0, 150),
        })),
      );
    } catch {
      this.events.snapshot({ state: "unavailable" });
    }
  }
  async close() {
    this.session.server?.close();
    await this.browser?.close();
  }
}
