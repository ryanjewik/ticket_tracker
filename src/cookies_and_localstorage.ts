import { saveJSON, readJSON, sitePaths } from './utils';
import type { Page } from 'puppeteer';
import dotenv from 'dotenv';

dotenv.config();

export type PersistLevel = 'none' | 'light' | 'full';
export const PERSIST_LEVEL: PersistLevel = (process.env.PERSIST_LEVEL as PersistLevel) || 'light';

export const COOKIE_BLOCKLIST =
  /^(forterToken|aws-waf-token|awswaf_token_refresh_timestamp|wsso|wsso-session|session|sid|ssid|csrf|xsrf|token|_rvt|_ga(_.+)?|_fbp|_gcl_au|_uetsid|_uetvid|lastRskxRun|rskxRunCookie|vmab_ptid|ulv-ed-event|auths|s)$/i;

export const isCookieAllowed = (name: string) => {
  if (PERSIST_LEVEL === 'none') return false;
  if (PERSIST_LEVEL === 'full') return !COOKIE_BLOCKLIST.test(name);
  // light
  return /^(locale|lang|country|currency|siteprefs|pref|ab|exp|variant)$/i.test(name)
    && !COOKIE_BLOCKLIST.test(name);
};

export const LS_ALLOW_REGEX = /^(ui_|ux_|pref|locale|currency|country|feature_|toggle_)/i;

export async function persistCookies(page: Page, siteKey: string) {
  if (PERSIST_LEVEL === 'none') return;
  const all = await page.cookies();
  const filtered = all
    .filter((c: any) => (c.domain || '').endsWith(siteKey))
    .filter((c: any) => isCookieAllowed(c.name));
  const { cookies } = sitePaths(siteKey);
  saveJSON(cookies, filtered);
  console.log(`Saved ${filtered.length} cookies for ${siteKey} (level=${PERSIST_LEVEL})`);
}

export async function restoreCookies(page: Page, siteKey: string) {
  if (PERSIST_LEVEL === 'none') return;
  const { cookies } = sitePaths(siteKey);
  const arr = readJSON<any[]>(cookies) || [];
  let restored = 0;
  for (const c of arr) {
    if (!c || !c.name || !isCookieAllowed(c.name)) continue;
    try { await page.setCookie(c); restored++; } catch {}
  }
  if (restored) console.log(`Restored ${restored} cookies for ${siteKey} (level=${PERSIST_LEVEL})`);
}

export async function persistLocalStorage(page: Page, siteKey: string) {
  if (PERSIST_LEVEL === 'none') return;
  const data = await page.evaluate(() => {
    const o: Record<string, string> = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k) o[k] = localStorage.getItem(k) as string;
      }
    } catch {}
    return o;
  });

  let filtered = data;
  if (PERSIST_LEVEL === 'light') {
    filtered = Object.fromEntries(Object.entries(data).filter(([k]) => LS_ALLOW_REGEX.test(k)));
  }

  const { ls } = sitePaths(siteKey);
  saveJSON(ls, filtered);
  console.log(`Saved ${Object.keys(filtered).length} LS keys for ${siteKey} (level=${PERSIST_LEVEL})`);
}

export async function restoreLocalStorage(page: Page, siteKey: string) {
  if (PERSIST_LEVEL === 'none') return;
  const { ls } = sitePaths(siteKey);
  const data = readJSON<Record<string, string>>(ls) || {};
  if (!Object.keys(data).length) return;
  await page.evaluate((obj: Record<string, string>) => {
    try { Object.entries(obj).forEach(([k, v]) => localStorage.setItem(k, v)); } catch {}
  }, data as Record<string, string>);
  console.log(`Restored ${Object.keys(data).length} LS keys for ${siteKey} (level=${PERSIST_LEVEL})`);
}
