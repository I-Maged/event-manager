import { Browser, BrowserContext, Page } from '@playwright/test';
import { storageStatePath } from './fixtures';

export async function newRoleContext(
  browser: Browser,
  role: string,
): Promise<BrowserContext> {
  return browser.newContext({ storageState: storageStatePath(role) });
}

export async function newRolePage(
  browser: Browser,
  role: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await newRoleContext(browser, role);
  const page = await context.newPage();
  return { context, page };
}

export async function closeRoleContext(context: BrowserContext): Promise<void> {
  await context.close();
}
