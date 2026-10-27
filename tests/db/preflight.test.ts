import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireProbeTarget } from '../../scripts/preflight';

describe('preflight guard', () => {
  const originalExit = process.exit;
  const originalArgv = process.argv;
  const originalAllow = process.env.PROBE_ALLOW;
  const originalDbUrl = process.env.DATABASE_URL;
  const originalDbUrlUnpooled = process.env.DATABASE_URL_UNPOOLED;

  let exitMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitMock = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    process.argv = ['node', 'script.ts'];
    process.env.PROBE_ALLOW = undefined;
    process.env.DATABASE_URL = undefined;
    process.env.DATABASE_URL_UNPOOLED = undefined;
  });

  afterEach(() => {
    process.exit = originalExit;
    process.argv = originalArgv;
    process.env.PROBE_ALLOW = originalAllow;
    process.env.DATABASE_URL = originalDbUrl;
    process.env.DATABASE_URL_UNPOOLED = originalDbUrlUnpooled;
    vi.restoreAllMocks();
  });

  it('refuses writes without --allow-writes or PROBE_ALLOW=1', () => {
    requireProbeTarget('preflight');
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it('does not exit when writes are explicitly allowed', () => {
    process.argv = ['node', 'script.ts', '--allow-writes'];
    requireProbeTarget('preflight');
    expect(exitMock).not.toHaveBeenCalled();
  });

  it('exits non-zero when PROBE_ALLOW is not set', () => {
    process.env.PROBE_ALLOW = '0';
    requireProbeTarget('preflight');
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it('prints hosts but never credentials', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.DATABASE_URL = 'postgresql://admin:secret-password@ep-abcd-pooler.c-6.aws.neon.tech/neondb?sslmode=require';
    process.env.DATABASE_URL_UNPOOLED = 'postgresql://admin:secret-password@ep-abcd.c-6.aws.neon.tech/neondb?sslmode=require';
    process.argv = ['node', 'script.ts', '--allow-writes'];

    requireProbeTarget('preflight');

    const output = errorSpy.mock.calls
      .map((args) => String(args[0]))
      .join('\n');
    expect(output).toContain('ep-abcd-pooler');
    expect(output).toContain('ep-abcd');
    expect(output).not.toContain('secret-password');
    expect(output).not.toContain('admin:');
  });
});
