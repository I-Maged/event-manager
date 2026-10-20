import { createNeonAuth } from "@neondatabase/auth/next/server";
import { requireEnv } from "@/lib/env";

/**
 * True for Next.js's intentional "hanging promise" rejection — a runtime read
 * (here `cookies()`) that Next rejects once a static prerender is complete.
 * See `HangingPromiseRejectionError` in `next/dist/server/dynamic-rendering-utils`.
 */
function isHangingPromiseRejection(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    (error as { digest?: unknown }).digest === "HANGING_PROMISE_REJECTION"
  );
}

// The Neon Auth SDK probes its session-data cookie cache before every
// `getSession()` call. On prerendered routes that probe reads `cookies()`,
// which Next rejects on purpose once the static shell is captured, so the SDK
// logs a benign "[neon-auth] Cookie validation error" warning per route at
// build time. Drop only that framework signal; forward every other warning.
const logger = {
  warn(message: string, meta?: Record<string, unknown>) {
    if (isHangingPromiseRejection(meta?.err)) return;
    console.warn(message, meta);
  },
};

export const auth = createNeonAuth({
  baseUrl: requireEnv("NEON_AUTH_BASE_URL"),
  cookies: {
    secret: requireEnv("NEON_AUTH_COOKIE_SECRET"),
  },
  logger,
});
