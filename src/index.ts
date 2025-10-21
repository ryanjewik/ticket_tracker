import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import {siteKeyFromUrl, sitePaths } from './utils';
import { PersistLevel, PERSIST_LEVEL, COOKIE_BLOCKLIST, isCookieAllowed, LS_ALLOW_REGEX, persistCookies, restoreCookies, persistLocalStorage, restoreLocalStorage } from './cookies_and_localstorage';
import { waitForTicketmasterState } from './ticketmaster';

dotenv.config();
const delay = (ms: number) => new Promise(res => setTimeout(res, ms));
const NAV_TIMEOUT = Number(process.env.NAV_TIMEOUT_MS ?? 90000);

/** ---------- loose navigation for heavy pages ---------- */
async function gotoLoose(page: any, url: string) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
  await page.waitForSelector('body', { timeout: 15000 });
  await page.waitForSelector('#__next, main', { timeout: 15000 }).catch(() => {});
  await delay(1500);
  // @ts-ignore – optional in newer puppeteer
  await page.waitForNetworkIdle?.({ idleTime: 1000, timeout: 6000 }).catch(() => {});
}

/** Wait for the page to really finish loading heavy client-side UIs */
async function waitForPageStable(page: any, opts: { timeoutMs?: number } = {}) {

  /** Human-like pauses and soft scrolling */
  async function humanJitter(page: any) {
  try { await page.mouse.wheel({ deltaY: 250 + Math.round(Math.random() * 300) }); } catch {}
  await delay(200 + Math.random() * 300);
  try { await page.mouse.move(100 + Math.random() * 400, 120 + Math.random() * 200); } catch {}
  }
  const { timeoutMs = 45000 } = opts;
  const start = Date.now();

  // 1) Document complete (best-effort)
  await page.waitForFunction(
    () => document.readyState === 'complete' || document.readyState === 'interactive',
    { timeout: Math.min(10000, timeoutMs) }
  ).catch(() => {});

  // 2) wait until network is idle
  await page.waitForNetworkIdle?.({ idleTime: 1200, timeout: 8000 }).catch(() => {});

  // 3) Repeatedly ensure no obvious loading bars are visible
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

export async function runScrape(url: string, site: string) {
  //configurations
  const siteKey = siteKeyFromUrl(url);
  const { siteDir } = sitePaths(siteKey);

  const WSE = process.env.BRIGHT_DATA_SCRAPING_BROWSER_WEBSOCKET_ENDPOINT || '';
  const HEADLESS = (process.env.HEADLESS || 'false').toLowerCase() === 'true';
  const TIMEZONE = process.env.TIMEZONE || 'America/Los_Angeles';
  const UA = process.env.USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119 Safari/537.36';

  // Start scrape
  console.log(`--- Starting scrape for ${site} at ${url} ---`);

  //connect the browser and setup browser configurations
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
      
  //setup the page configurations
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  const client = await page.target().createCDPSession();
  try { await client.send('Emulation.setTimezoneOverride', { timezoneId: TIMEZONE }); } catch {}
  await page.setCacheEnabled(false);
  page.setDefaultNavigationTimeout(NAV_TIMEOUT);

  //go to page, set cookies/local storage, human delays, get the html then save the cookies/local storage
  try {
    //go to page
    await gotoLoose(page, url);

    // Restore mildly neutral state (cookies -> reload, LS -> reload)
    await restoreCookies(page, siteKey);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    await page.waitForSelector('#__next, main', { timeout: 15000 }).catch(() => {});
    await restoreLocalStorage(page, siteKey);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    await page.waitForSelector('#__next, main', { timeout: 15000 }).catch(() => {});

    // human-like idle
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
