/**
 * Read a required environment variable or fail with an actionable message.
 * Never include the value in the error (secrets must not reach logs).
 *
 * The lookup is deliberately dynamic (`process.env[name]`): Next.js loads
 * `.env*` automatically, and Proxy defaults to the Node.js runtime in v16, so
 * this is safe for every server entry point that imports it.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(
      `Missing required environment variable "${name}". ` +
        'Add it to .env (see .env.example) or the deploy environment.',
    );
  }
  return value;
}
