import { observeControls } from "./perception.js";
import { locate } from "./targeting.js";
import {
  TenantProfile,
  harborProfile,
  resolveProfileTarget,
  digest,
  type Profile,
  applicationConfig,
  type ApplicationConfig,
} from "./profile.js";
import { chromium, Browser, Page, Locator } from "playwright";
import { RunError, Target } from "./contracts.js";
import { z } from "zod";
import { Events } from "./events.js";
import { Session } from "./session.js";
import { defaultPolicy, executionPolicy, type PolicyInput } from "./policy.js";
export class Surface {
  readonly config: ApplicationConfig;
  readonly policy: ReturnType<typeof executionPolicy>;
  browser!: Browser;
  page!: Page;
  violation = false;
  readonly deadline: number;
  stepIndex = 0;
  diagnostics: {
    action?: string;
    phase?: string;
    matches?: number;
    candidate_index?: number;
    visible?: boolean;
    enabled?: boolean;
    expected_path?: string;
    checkpoint_passed?: boolean;
  } = {};
  document() {
    if (!this.profile.frame_name) return this.page;
    const frames = this.page
      .frames()
      .filter((frame) => frame.name() === this.profile.frame_name);
    if (frames.length !== 1)
      throw new RunError(frames.length ? "AMBIGUOUS_FRAME" : "FRAME_NOT_FOUND");
    return frames[0]!;
  }
  constructor(
    readonly base: string,
    readonly events: Events,
    readonly session: Session,
    policy: PolicyInput = defaultPolicy,
    readonly profile: Profile = harborProfile,
  ) {
    this.deadline = Date.now() + (session.interactive ? 900000 : 180000);
    this.policy = executionPolicy(policy);
    this.config = applicationConfig(TenantProfile.parse(profile));
    this.session.guidance = async () => {
      if (this.violation || !this.allowed(this.document().url()))
        return "The browser left an allowed destination. Cancel this run and restart.";
      for (const blocker of this.config.authentication)
        if (await this.locator(blocker.target).count()) return blocker.guidance;
      return "Resolve the blocker in the application window, then click Resume to validate the current state.";
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
    if (this.profile.frame_name) {
      const frame = this.page.locator(
        `iframe[name="${this.profile.frame_name}"]`,
      );
      if ((await frame.count()) !== 1)
        throw new RunError(
          (await frame.count()) ? "AMBIGUOUS_FRAME" : "FRAME_NOT_FOUND",
        );
      await frame.waitFor({ state: "visible", timeout: 4000 });
      await this.document().waitForLoadState("domcontentloaded");
    }
    await this.identity();
    this.events.emit("profile_verified", {
      profile_digest: digest(this.profile),
      tenant_id: this.profile.tenant_id,
    });
  }
  async identity() {
    for (const marker of this.config.markers) {
      const element = this.locator(marker.target);
      if ((await element.count()) !== 1) throw new RunError(marker.code);
      const actual = marker.attribute
        ? await element.getAttribute(marker.attribute)
        : await element.textContent();
      if (actual !== marker.expected) throw new RunError(marker.code);
    }
  }

  check() {
    this.session.assertAutomation();
    if (Date.now() > this.deadline) throw new RunError("RUN_TIMEOUT");
    if (this.violation || !this.allowed(this.document().url()))
      throw new RunError("POLICY_BLOCKED");
  }
  locator(target: z.infer<typeof Target>): Locator {
    target = resolveProfileTarget(target, this.profile);
    return locate(this.document(), target);
  }

  async ensureAuthentication(
    validate: (loginRequired: boolean) => Promise<boolean>,
  ) {
    this.check();
    const blocked = async () => {
      for (const blocker of this.config.authentication)
        if (await this.locator(blocker.target).count()) return true;
      return false;
    };
    if (await blocked()) {
      const checkpointURL = this.document().url();
      this.session.step = this.stepIndex;
      await this.evidence();
      await this.session.handoff("AUTH_REQUIRED", async () => {
        if (
          this.violation ||
          !this.allowed(this.document().url()) ||
          this.document().url() !== checkpointURL
        )
          return false;
        await this.identity();
        return !(await blocked()) && (await validate(true));
      });
    }
  }
  // Shared browser mutation gateway. Workflow-specific invariants live in the caller's guard.
  async performAction(
    step: {
      action: "fill" | "click";
      target: z.infer<typeof Target>;
      input?: string;
      postcondition?:
        | { kind: "path"; value: string }
        | { kind: "field_equals_input"; input: string };
    },
    input: Record<string, string>,
    guard: () => Promise<void>,
    resolvedTarget?: Locator,
  ) {
    const candidateIndex = resolvedTarget
      ? this.diagnostics.candidate_index
      : undefined;
    this.diagnostics = {
      action: step.action,
      phase: "preflight",
      candidate_index: candidateIndex,
    };
    this.check();
    if (!this.policy.actions.includes(step.action))
      throw new RunError("POLICY_BLOCKED");
    await guard();
    await this.identity();
    const target = resolvedTarget ?? this.locator(step.target);
    const count = await target.count();
    this.diagnostics = {
      action: step.action,
      phase: "resolve_target",
      matches: count,
      candidate_index: candidateIndex,
    };
    if (count !== 1)
      throw new RunError(count ? "AMBIGUOUS_TARGET" : "TARGET_NOT_FOUND");
    this.diagnostics.visible = await target.isVisible();
    this.diagnostics.enabled = await target.isEnabled();
    if (!this.diagnostics.visible || !this.diagnostics.enabled)
      throw new RunError("TARGET_NOT_ACTIONABLE");
    // Independent application policy inspects the actual control, never a model risk label.
    this.check();
    const info = await target.evaluate((el) => {
      const form = (el as HTMLInputElement).form ?? el.closest("form");
      return {
        tag: el.tagName,
        name: el.getAttribute("name"),
        text: el.textContent?.trim(),
        href: el instanceof HTMLAnchorElement ? el.href : null,
        linkTarget: el instanceof HTMLAnchorElement ? el.target : "",
        inputType: el instanceof HTMLInputElement ? el.type : null,
        action: el.hasAttribute("formaction")
          ? (el as HTMLButtonElement).formAction
          : form?.action,
        method: (
          el.getAttribute("formmethod") ??
          form?.method ??
          "get"
        ).toLowerCase(),
        formTarget: el.getAttribute("formtarget") ?? form?.target ?? "",
        buttonType: el instanceof HTMLButtonElement ? el.type : null,
      };
    });
    const permittedReadForm = Boolean(
      info.action &&
      this.allowed(info.action) &&
      this.policy.read_forms.includes(new URL(info.action).pathname) &&
      info.method === "get" &&
      ["", "_self"].includes(info.formTarget),
    );
    const translated = this.config.overrides.find(
      (entry) => entry.to.by === "role" && entry.to.value === info.text,
    );
    const canonicalText = translated?.from.value ?? info.text;
    this.check();
    if (step.action === "fill") {
      if (
        info.tag !== "INPUT" ||
        !["text", "search"].includes(info.inputType ?? "") ||
        !permittedReadForm ||
        !this.policy.fill_names.includes(info.name ?? "") ||
        !step.input
      )
        throw new RunError("POLICY_BLOCKED");
      this.diagnostics.phase = "dispatch";
      if (!Object.hasOwn(input, step.input))
        throw new RunError("INVALID_BINDING");
      await target.fill(input[step.input]!);
      if ((await target.inputValue()) !== input[step.input])
        throw new RunError("FIELD_NOT_SET");
    } else {
      const safeLink =
        info.tag === "A" &&
        info.href &&
        ["", "_self"].includes(info.linkTarget) &&
        this.allowed(new URL(info.href, this.base).href) &&
        this.policy.link_labels.includes(canonicalText ?? "");
      const safeSubmit =
        info.tag === "BUTTON" &&
        this.policy.submit_labels.includes(canonicalText ?? "") &&
        info.buttonType === "submit" &&
        permittedReadForm;
      if (!safeLink && !safeSubmit) throw new RunError("POLICY_BLOCKED");
      const before = this.document().url();
      this.diagnostics.phase = "dispatch";
      await target.click();
      await this.document()
        .waitForURL((url) => url.href !== before, { timeout: 4000 })
        .catch(() => {
          throw new RunError("POSTCONDITION_TIMEOUT");
        });
      await this.document().waitForLoadState("domcontentloaded");
    }
    this.check();
    await this.identity();
    this.diagnostics.phase = "checkpoint";
    if (step.postcondition?.kind === "path") {
      this.diagnostics.expected_path = this.policy.routes.includes(
        step.postcondition.value,
      )
        ? step.postcondition.value
        : "disallowed";
      this.diagnostics.checkpoint_passed =
        new URL(this.document().url()).pathname === step.postcondition.value;
    }
    if (
      step.postcondition?.kind === "path" &&
      new URL(this.document().url()).pathname !== step.postcondition.value
    )
      throw new RunError("CHECKPOINT_MISMATCH");
    // Persist a semantic descriptor of the permitted control, not model-supplied CSS
    // or a selector containing invocation data. The fixed profile supplies safe labels.
    this.events.emit("action_verified", {
      step: this.stepIndex,
      action: step.action,
      code: "POSTCONDITION_VERIFIED",
      match_count: count,
    });
    return {
      action: step.action,
      postcondition:
        step.action === "fill"
          ? { kind: "field_equals_input" as const, input: step.input! }
          : {
              kind: "path" as const,
              value: new URL(this.document().url()).pathname,
            },
      target:
        step.action === "fill"
          ? step.target
          : {
              by: "role" as const,
              role: info.tag === "A" ? ("link" as const) : ("button" as const),
              value: canonicalText!,
            },
      ...(step.action === "fill" ? { input: step.input! } : {}),
    };
  }
  async intervene(code: string, validate: () => Promise<boolean>) {
    await this.evidence();
    this.session.step = this.stepIndex;
    await this.session.handoff(code, validate);
    this.check();
  }
  async observe() {
    return {
      path: new URL(this.document().url()).pathname,
      controls: (await observeControls(this.document())).flat(),
      snapshot: (await this.document().locator("body").ariaSnapshot()).slice(
        0,
        12000,
      ),
    };
  }
  async evidence() {
    const failure = [...this.events.history]
      .reverse()
      .find((e) =>
        ["failure", "intervention", "business_outcome"].includes(e.type),
      );
    let structure: unknown = { state: "unavailable" };
    let route = "unavailable";
    try {
      const url = new URL(this.document().url());
      route = this.allowed(url.href) ? url.pathname : "disallowed";
      structure = await this.document()
        .locator("body")
        .evaluate((el) => ({
          tags: Array.from(el.querySelectorAll("*"))
            .slice(0, 150)
            .map((x) => ({
              tag: x.tagName,
              role: [
                "button",
                "link",
                "status",
                "alert",
                "heading",
                "textbox",
                "table",
                "row",
                "cell",
              ].includes(x.getAttribute("role") ?? "")
                ? x.getAttribute("role")
                : null,
            })),
        }));
    } catch {}
    this.events.snapshot({
      schema_version: 1,
      step: this.stepIndex,
      code: failure?.code,
      route,
      ownership: this.session.owner,
      framed: Boolean(this.profile.frame_name),
      diagnostics: this.diagnostics,
      structure,
    });
  }
  async close() {
    this.session.server?.close();
    await this.browser?.close();
  }
}
