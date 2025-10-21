// src/index.ts
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { runTicketmasterFlow } from './sites/ticketmasterFlow';

dotenv.config();

/** ---------- config ---------- */
type PersistLevel = 'none' | 'light' | 'full';
const PERSIST_LEVEL: PersistLevel = (process.env.PERSIST_LEVEL as PersistLevel) || 'light';

const ROOT_DIR = path.resolve(process.cwd(), '.session_data');
const delay = (ms: number) => new Promise(res => setTimeout(res, ms));
const NAV_TIMEOUT = Number(process.env.NAV_TIMEOUT_MS ?? 90000);

/** ---------- helpers ---------- */
function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

// naive eTLD+1 (last two labels is fine for these domains)
function siteKeyFromUrl(url: string) {
  const { hostname } = new URL(url);
  const parts = hostname.split('.').filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join('.') : hostname;
}

function sitePaths(siteKey: string) {
  const siteDir = path.join(ROOT_DIR, siteKey);
  ensureDir(siteDir);
  return {
    siteDir,
    cookies: path.join(siteDir, 'cookies.json'),
    ls: path.join(siteDir, 'localstorage.json'),
    networkLog: path.join(siteDir, 'network_log.json'),
  };
}

function saveJSON(p: string, v: any) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(v, null, 2), 'utf8');
}
function readJSON<T = any>(p: string): T | null {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** ---------- neutral persistence filters ---------- */
// Block sensitive/identity cookies
const COOKIE_BLOCKLIST =
  /^(forterToken|aws-waf-token|awswaf_token_refresh_timestamp|wsso|wsso-session|session|sid|ssid|csrf|xsrf|token|_rvt|_ga(_.+)?|_fbp|_gcl_au|_uetsid|_uetvid|lastRskxRun|rskxRunCookie|vmab_ptid|ulv-ed-event|auths|s)$/i;

// Allow simple “neutral” prefs when in light mode
const isCookieAllowed = (name: string) => {
  if (PERSIST_LEVEL === 'none') return false;
  if (PERSIST_LEVEL === 'full') return !COOKIE_BLOCKLIST.test(name);
  // light
  return /^(locale|lang|country|currency|siteprefs|pref|ab|exp|variant)$/i.test(name)
    && !COOKIE_BLOCKLIST.test(name);
};

// LocalStorage neutral keys to keep in light mode
const LS_ALLOW_REGEX = /^(ui_|ux_|pref|locale|currency|country|feature_|toggle_)/i;

/** ---------- per-site persistence ---------- */
async function persistCookies(page: any, siteKey: string) {
  if (PERSIST_LEVEL === 'none') return;
  const all = await page.cookies();
  const filtered = all
    .filter((c: any) => (c.domain || '').endsWith(siteKey))
    .filter((c: any) => isCookieAllowed(c.name));
  const { cookies } = sitePaths(siteKey);
  saveJSON(cookies, filtered);
  console.log(`Saved ${filtered.length} cookies for ${siteKey} (level=${PERSIST_LEVEL})`);
}

async function restoreCookies(page: any, siteKey: string) {
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

async function persistLocalStorage(page: any, siteKey: string) {
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

async function restoreLocalStorage(page: any, siteKey: string) {
  if (PERSIST_LEVEL === 'none') return;
  const { ls } = sitePaths(siteKey);
  const data = readJSON<Record<string, string>>(ls) || {};
  if (!Object.keys(data).length) return;
  await page.evaluate((obj: Record<string, string>) => {
    try { Object.entries(obj).forEach(([k, v]) => localStorage.setItem(k, v)); } catch {}
  }, data as Record<string, string>);
  console.log(`Restored ${Object.keys(data).length} LS keys for ${siteKey} (level=${PERSIST_LEVEL})`);
}


/** ---------- loose navigation for heavy pages ---------- */
async function gotoLoose(page: any, url: string) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
  await page.waitForSelector('body', { timeout: 15000 });
  await page.waitForSelector('#__next, main', { timeout: 15000 }).catch(() => {});
  await delay(1500);
  // @ts-ignore – optional in newer puppeteer
  await page.waitForNetworkIdle?.({ idleTime: 1000, timeout: 6000 }).catch(() => {});
}

/** ---------- public API for server.ts ---------- */
export async function runScrape(url: string, site: string) {
  const siteKey = siteKeyFromUrl(url);
  const { siteDir } = sitePaths(siteKey);

  const WSE = process.env.BRIGHT_DATA_SCRAPING_BROWSER_WEBSOCKET_ENDPOINT || '';
  const HEADLESS = (process.env.HEADLESS || 'false').toLowerCase() === 'true';
  const TIMEZONE = process.env.TIMEZONE || 'America/Los_Angeles';
  const UA = process.env.USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119 Safari/537.36';

  console.log(`\n--- Starting scrape for ${site} at ${url} ---`);

  const puppeteerLib = WSE ? await import('puppeteer-core') : await import('puppeteer');
  const browser = WSE
    ? await puppeteerLib.connect({ browserWSEndpoint: WSE, defaultViewport: null })
    : await puppeteerLib.launch({
        headless: HEADLESS,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--start-maximized',
          '--disable-blink-features=AutomationControlled'
        ],
        defaultViewport: null,
      });

  const page = await browser.newPage();
  await page.setUserAgent(UA);

  const client = await page.target().createCDPSession();
  try { await client.send('Emulation.setTimezoneOverride', { timezoneId: TIMEZONE }); } catch {}

  await page.setCacheEnabled(false);
  page.setDefaultNavigationTimeout(NAV_TIMEOUT);

  try {
    // Navigate loosely (helps on Ticketmaster-like pages)
    await gotoLoose(page, url);

    // Restore mildly neutral state (cookies -> reload, LS -> reload)
    await restoreCookies(page, siteKey);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    await page.waitForSelector('#__next, main', { timeout: 15000 }).catch(() => {});

    await restoreLocalStorage(page, siteKey);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    await page.waitForSelector('#__next, main', { timeout: 15000 }).catch(() => {});

    // small human-like idle
    await delay(600 + Math.random() * 900);
    await page.mouse.wheel({ deltaY: 200 });
    await delay(300 + Math.random() * 700);


    const siteHost = new URL(url).hostname;
    const siteDir = path.join('.session_data', siteHost.replace(/^www\./, ''));

    // ---- Ticketmaster special flow ----
    if (site === 'ticketmaster') {
        try {
            await runTicketmasterFlow(page, siteDir);
        } catch (err) {
            console.error('Ticketmaster flow failed:', err);
        }
    }

    // Save HTML + Screenshot (per-site folder)
    const html = await page.content();
    const htmlPath = path.join(siteDir, `page_${Date.now()}.html`);
    fs.writeFileSync(htmlPath, html, 'utf8');
    console.log('Saved HTML:', htmlPath);

    const screenshotPath = path.join(siteDir, `screenshot_${Date.now()}.png`) as `${string}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log('Saved screenshot:', screenshotPath);

    // Persist neutral prefs for next run
    await persistCookies(page, siteKey);
    await persistLocalStorage(page, siteKey);
  } catch (err: any) {
    console.error(`Navigation error for ${site}:`, err?.message || err);
  } finally {
    if (WSE) await browser.disconnect();
    else await browser.close();
  }
}

/** ---------- manual run (optional) ---------- */
if (require.main === module) {
  (async () => {
    const envUrls: Array<{site: string; url: string | undefined}> = [
      { site: 'stubhub', url: process.env.STUBHUB_URL },
      { site: 'vividseats', url: process.env.VIVIDSEATS_URL },
      { site: 'ticketmaster', url: process.env.TICKETMASTER_URL },
      { site: 'seatgeek', url: process.env.SEATGEEK_URL },
    ].filter(v => v.url);
    for (const { site, url } of envUrls) {
      await runScrape(url!, site);
    }
  })();
}
