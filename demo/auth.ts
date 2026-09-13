import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

// Fictional credentials only. This is a local authentication simulator.
export const demoCredentials = {
  username: "demo.teller",
  password: "DemoBank!2026",
  code: "482916",
};
type State = {
  csrf: string;
  returnTo: string;
  phase: "login" | "verify" | "authenticated";
  expires: number;
  attempts: number;
  interrupted: boolean;
};
export function createDemoAuth(expireAtAccount: boolean, now = Date.now) {
  const sessions = new Map<string, State>();
  const token = () => randomBytes(24).toString("hex");
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<string | null> => {
    const authRoute = ["/login", "/verify", "/logout"].includes(url.pathname);
    const protectedRoute = [
      "/",
      "/members",
      "/results",
      "/member",
      "/account",
    ].includes(url.pathname);
    if (!authRoute && !protectedRoute) return null;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "same-origin");
    for (const [key, state] of sessions)
      if (state.expires + 600000 < now()) sessions.delete(key);
    let sid =
      req.headers.cookie
        ?.split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith("bank-session="))
        ?.slice(13) ?? "";
    let state = sessions.get(sid);
    const setCookie = () =>
      res.setHeader(
        "Set-Cookie",
        `bank-session=${sid}; HttpOnly; SameSite=Strict; Path=/`,
      );
    if (!state) {
      if (sessions.size >= 500) {
        res.statusCode = 503;
        return "<h1>Demo capacity reached</h1>";
      }
      sid = token();
      state = {
        csrf: token(),
        returnTo: protectedRoute ? url.pathname + url.search : "/",
        phase: "login",
        expires: now() + 300000,
        attempts: 0,
        interrupted: false,
      };
      sessions.set(sid, state);
      setCookie();
    }
    let message = "";
    if (
      state.phase === "authenticated" &&
      (state.expires <= now() ||
        (expireAtAccount && url.pathname === "/account" && !state.interrupted))
    ) {
      state.phase = "login";
      state.interrupted = true;
      state.csrf = token();
      state.attempts = 0;
      message = "Your session expired. Sign in again to continue your work.";
    }
    if (protectedRoute && state.phase === "authenticated") return null;
    if (protectedRoute) state.returnTo = url.pathname + url.search;
    if (authRoute && req.method === "POST") {
      const origin = req.headers.origin;
      if (origin !== `http://${req.headers.host}`) {
        res.statusCode = 403;
        return "<h1>Request rejected</h1>";
      }
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 4096) {
          res.statusCode = 413;
          return "<h1>Request too large</h1>";
        }
      }
      const data = new URLSearchParams(body);
      if (data.get("csrf") !== state.csrf) {
        res.statusCode = 403;
        return "<h1>Request rejected</h1>";
      }
      if (url.pathname === "/logout") {
        sessions.delete(sid);
        res.writeHead(303, {
          Location: "/",
          "Set-Cookie":
            "bank-session=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/",
        });
        res.end();
        return "";
      }
      if (data.get("restart") === "yes" && state.phase === "verify") {
        state.phase = "login";
        state.attempts = 0;
        state.csrf = token();
      } else if (url.pathname === "/login" && state.phase === "login") {
        if (state.attempts >= 3 && state.expires > now())
          message = "Too many attempts. Wait 30 seconds before trying again.";
        else {
          if (state.attempts >= 3) state.attempts = 0;
          if (
            data.get("username") === demoCredentials.username &&
            data.get("password") === demoCredentials.password
          ) {
            state.phase = "verify";
            state.attempts = 0;
            state.expires = now() + 120000;
            state.csrf = token();
          } else {
            state.attempts++;
            state.expires = now() + 30000;
            message = "Username or password is incorrect.";
          }
        }
      } else if (url.pathname === "/verify" && state.phase === "verify") {
        if (state.expires <= now())
          message = "Your verification code expired. Start sign-in again.";
        else if (state.attempts >= 3)
          message = "Too many incorrect codes. Start sign-in again.";
        else if (data.get("code") !== demoCredentials.code) {
          state.attempts++;
          message = "Incorrect verification code. Try again.";
        } else {
          state.phase = "authenticated";
          state.expires = now() + 300000;
          state.csrf = token();
          sessions.delete(sid);
          sid = token();
          sessions.set(sid, state);
          setCookie();
          res.writeHead(303, { Location: state.returnTo });
          res.end();
          return "";
        }
      }
    }
    const hidden = `<input type="hidden" name="csrf" value="${state.csrf}">`;
    const error = message ? `<p role="alert">${message}</p>` : "";
    return `<section data-auth-required="true"><p class="eyebrow">STAFF ACCESS</p>${
      state.phase === "verify"
        ? `<h1>Verify your identity</h1><p>Enter the six-digit code from your demo authenticator.</p>${error}<form method="POST" action="/verify">${hidden}<label>Verification code<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required autofocus></label><button>Verify and continue</button></form><form method="POST" action="/login">${hidden}<button class="secondary" name="restart" value="yes">Start sign-in again</button></form><aside>Demo code: <strong>${demoCredentials.code}</strong>. Valid for two minutes. No SMS or email is sent.</aside>`
        : `<h1>Sign in to staff banking</h1><p>Use your fictional staff account to access member services.</p>${error}<form method="POST" action="/login">${hidden}<label>Username<input name="username" autocomplete="username" required autofocus></label><label>Password<input type="password" name="password" autocomplete="current-password" required></label><button>Sign in</button></form><aside>Demo username: <strong>${demoCredentials.username}</strong><br>Demo password: <strong>${demoCredentials.password}</strong><br>Use these fictional credentials only.</aside>`
    }</section>`;
  };
}
