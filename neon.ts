import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  auth: true,
  functions: {
    // Function slugs must be 1-20 lowercase letters/digits, and are permanent
    // once deployed; keep it stable.
    ratelimitgc: {
      name: "RateLimit GC",
      source: "./functions/rate-limit-cleanup.ts",
    },
  },
  triggers: {
    // Hourly, UTC. Runs even when the compute is scaled to zero. Inherited
    // triggers on child branches start disabled, so dev branches stay quiet
    // until they are enabled explicitly.
    "rate-limit-gc-hourly": {
      type: "schedule",
      function: "ratelimitgc",
      cron: "17 * * * *",
    },
  },
});
