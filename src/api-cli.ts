import { readFileSync } from "node:fs";
import { startCapabilityApi, browserExecutor } from "./capability-api.js";
import { TenantProfile, harborProfile } from "./profile.js";
import { Policy, defaultPolicy } from "./policy.js";
try {
  process.loadEnvFile(".env");
} catch {}
const profile = process.env.PROFILE_FILE
  ? TenantProfile.parse(
      JSON.parse(readFileSync(process.env.PROFILE_FILE, "utf8")),
    )
  : harborProfile;
const policy = process.env.POLICY_FILE
  ? Policy.parse(JSON.parse(readFileSync(process.env.POLICY_FILE, "utf8")))
  : defaultPolicy;
const api = await startCapabilityApi(
  browserExecutor(process.env.DEMO_URL ?? profile.base_url, profile, policy),
  Number(process.env.API_PORT ?? 4182),
);
console.log(`Capability API: ${api.url}`);
console.log(`Bearer token (local access; do not share): ${api.token}`);
console.log(
  "GET /capabilities; POST /capabilities/{name}/invoke. Ctrl+C to stop.",
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void api.close();
  });
