// src/index.ts
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
// import { scrapeTicketmasterFlow } from './sites/ticketmaster_flow';

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

/** ---------- network capture ---------- */
async function addNetworkCapture(page: any, client: any, siteDir: string) {
  const entries: any[] = [];
  await client.send('Network.enable');

  client.on('Network.requestWillBeSent', (p: any) => {
    entries.push({ t: Date.now(), kind: 'req', url: p.request.url, method: p.request.method });
  });
  client.on('Network.responseReceived', async (p: any) => {
    const { response, requestId } = p;
    entries.push({ t: Date.now(), kind: 'res', url: response.url, status: response.status });
    if ([401, 403, 429].includes(response.status) ||
        /robot|captcha|unique id|we think you/i.test(response.url + ' ' + (response.statusText || ''))) {
      try {
        const body = await client.send('Network.getResponseBody', { requestId });
        const text = body?.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body?.body || '';
        const fn = path.join(siteDir, `suspicious_response_${Date.now()}.html`);
        fs.writeFileSync(fn, text, 'utf8');
        console.log('Saved suspicious response to', fn);
      } catch {}
    }
  });
  page.on('response', async (res: any) => {
    try {
      const s = res.status();
      if (s >= 400 || /robot|captcha|unique id|we think you/i.test(res.url())) {
        const text = await res.text().catch(() => '');
        const fn = path.join(siteDir, `puppeteer_response_${Date.now()}.html`);
        fs.writeFileSync(fn, text, 'utf8');
        console.log('Saved puppeteer response to', fn);
      }
    } catch {}
  });
  page.on('requestfailed', (r: any) => console.log('request failed', r.url(), r.failure()?.errorText));

  const { networkLog } = sitePaths(path.basename(siteDir));
  process.on('exit', () => {
    try { fs.writeFileSync(networkLog, JSON.stringify(entries, null, 2), 'utf8'); } catch {}
  });
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

/** Human-like pauses and soft scrolling */
async function humanJitter(page: any) {
  try { await page.mouse.wheel({ deltaY: 250 + Math.round(Math.random() * 300) }); } catch {}
  await delay(200 + Math.random() * 300);
  try { await page.mouse.move(100 + Math.random() * 400, 120 + Math.random() * 200); } catch {}
}

/** Wait for the page to really finish loading heavy client-side UIs */
async function waitForPageStable(page: any, opts: { timeoutMs?: number } = {}) {
  const { timeoutMs = 45000 } = opts;
  const start = Date.now();

  // 1) Document complete (best-effort)
  await page.waitForFunction(
    () => document.readyState === 'complete' || document.readyState === 'interactive',
    { timeout: Math.min(10000, timeoutMs) }
  ).catch(() => {});

  // 2) A bit of network idle (not always available)
  // @ts-ignore - optional in recent Puppeteer
  await page.waitForNetworkIdle?.({ idleTime: 1200, timeout: 8000 }).catch(() => {});

  // 3) Repeatedly ensure no obvious spinners/overlays are visible
  const spinnerSel = '[aria-busy="true"], [role="progressbar"], [data-testid*="spinner" i], [class*="spinner" i], [class*="loading" i]';
  while (Date.now() - start < timeoutMs) {
    const hasSpinner = await page.$(spinnerSel).then((n: any) => !!n).catch(() => false);

    // Some sites render an explicit "Loading" text overlay
    const hasLoadingText = await page.evaluate(() => /loading/i.test(document.body?.innerText || ''));

    if (!hasSpinner && !hasLoadingText) {
      // Double animation frame to settle layout/layout-shift
      await page.evaluate(
        () => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())))
      ).catch(() => {});
      break;
    }

    await humanJitter(page);
  }

  // 4) One last small idle
  await delay(300 + Math.random() * 400);
}


/** ---------- Ticketmaster inventory/unavailable wait ---------- */
async function waitForTicketmasterState(page: any): Promise<'inventory'|'unavailable'|'unknown'> {
  const timeoutMs = 35000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      const hasInventoryText = /LOWEST PRICE|BEST SEATS|Verified Resale Ticket|GENERAL ADMISSION|Price includes fees/i.test(text);
      const hasUnavailable = /tickets are not currently available online|no tickets currently available/i.test(text);
      const priceUI = !!document.querySelector('input[type="range"], [data-qa*="price" i], [aria-label*="price" i]');
      const ticketCards = document.querySelectorAll('[data-qa*="ticket" i], [data-testid*="ticket" i], [class*="Ticket" i]').length > 0;
      return { hasInventory: hasInventoryText || priceUI || ticketCards, hasUnavailable };
    });
    if (res.hasUnavailable) return 'unavailable';
    if (res.hasInventory) return 'inventory';
    try { await new Promise(r => setTimeout(r, 800)); } catch {}
    try { await page.mouse.wheel({ deltaY: 400 }); } catch {}
  }
  return 'unknown';
}


export async function runScrape(url: string, site: string) {
  const siteKey = siteKeyFromUrl(url);
  const { siteDir } = sitePaths(siteKey);

  const WSE = process.env.BRIGHT_DATA_SCRAPING_BROWSER_WEBSOCKET_ENDPOINT || '';
  const HEADLESS = (process.env.HEADLESS || 'false').toLowerCase() === 'true';
  const TIMEZONE = process.env.TIMEZONE || 'America/Los_Angeles';
  const UA = process.env.USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119 Safari/537.36';

  console.log(`
--- Starting scrape for ${site} at ${url} ---`);

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
  // Bright Data remote blocks changing accept-language; only set it locally
  if (!WSE) {
    await page.setExtraHTTPHeaders({ 'accept-language': 'en-US,en;q=0.9' });
  }

  const client = await page.target().createCDPSession();
  try { await client.send('Emulation.setTimezoneOverride', { timezoneId: TIMEZONE }); } catch {}

  await addNetworkCapture(page, client, siteDir);
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

    await waitForPageStable(page, { timeoutMs: 45000 });

    // Ticketmaster specific: wait until either inventory loads or a definitive unavailable banner appears
    if (siteKey.endsWith('ticketmaster.com')) {
      const state = await waitForTicketmasterState(page);
      console.log('Ticketmaster state:', state);
      // small idle to let UI settle
      await delay(600 + Math.random() * 700);
    }

    // If this is a Ticketmaster homepage or search-flow, run the interactive flow
    // (temporarily disabled Ticketmaster interactive flow)
    // if (site === 'ticketmaster' && process.env.TM_SEARCH_FLOW === 'true') {
    //   await scrapeTicketmasterFlow(page, {
    //     artist: process.env.ARTIST_NAME || 'Lamp',
    //     dateISO: process.env.EVENT_DATE || '2025-11-07',
    //     venue: process.env.VENUE_NAME || 'House of Blues Anaheim',
    //     city: process.env.VENUE_CITY || 'Anaheim',
    //     state: process.env.VENUE_STATE || 'CA',
    //     siteDir,
    //   });
    // }

    // sanity
    const jsChecks = await page.evaluate(() => ({
      hasWindow: typeof window === 'object',
      webdriver: (navigator as any).webdriver || false,
      ua: navigator.userAgent,
      cookies: document.cookie,
      localStorageLen: (() => { try { return Object.keys(localStorage).length; } catch { return -1; } })(),
      docReady: document.readyState,
    }));
    console.log(`JS checks for ${site}:`, jsChecks);

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
