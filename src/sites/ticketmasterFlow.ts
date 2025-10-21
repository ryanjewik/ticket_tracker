// src/sites/ticketmasterFlow.ts
import type { Page } from 'puppeteer-core';
import fs from 'fs/promises';
import path from 'path';

const rand = (min: number, max: number) => Math.floor(min + Math.random() * (max - min + 1));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const humanPause = async (min = 200, max = 700) => sleep(rand(min, max));

function monthShortName(m: number) {
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m];
}

function buildDateTextCandidates(dateISO: string) {
  // dateISO: 'YYYY-MM-DD'
  const [y, m, d] = dateISO.split('-').map((s) => parseInt(s, 10));
  const short = monthShortName(m - 1);
  const dd = String(d);
  const ddPad = d < 10 ? `0${d}` : String(d);

  // Common variants we’ve seen on TM
  const candidates = [
    `${short} ${d}`, `${short} ${dd}`, `${short}. ${d}`, `${short}. ${dd}`,
    `${short.toUpperCase()} ${d}`, `${short.toUpperCase()} ${dd}`,
    `November ${d}`, `NOVEMBER ${d}`, // helpful for your current example (m=11)
    `${m}/${ddPad}`, `${ddPad}/${m}`,
    `${short} ${dd}, ${y}`,
  ];

  // De-dup
  return Array.from(new Set(candidates));
}

async function clickFirstVisibleButtonByText(page: Page, texts: string[], timeout = 4500) {
  await page.waitForFunction(
    (labels) => {
      const nodes = Array.from(document.querySelectorAll('button,[role="button"],a'));
      return nodes.some(n => {
        const t = (n.textContent || '').trim().toLowerCase();
        if (!t) return false;
        return labels.some(l => t.includes(l.toLowerCase()));
      });
    },
    { timeout },
    texts
  );

  await page.evaluate((labels) => {
    const nodes = Array.from(document.querySelectorAll('button,[role="button"],a'));
    for (const n of nodes) {
      const t = (n.textContent || '').trim().toLowerCase();
      if (!t) continue;
      for (const l of labels) {
        if (t.includes(l.toLowerCase())) {
          (n as HTMLElement).scrollIntoView({ block: 'center' });
          (n as HTMLElement).click();
          return;
        }
      }
    }
  }, texts);
}

async function typeIntoOneOf(page: Page, selectors: string[], text: string, typeDelay = 40) {
  for (const sel of selectors) {
    try {
      const el = await page.waitForSelector(sel, { timeout: 5000 });
      if (!el) continue;
      await el.click({ clickCount: 3 });
      await humanPause(150, 400);
      await page.keyboard.type(text, { delay: typeDelay + rand(0, 40) });
      return true;
    } catch {
      // try next selector
    }
  }
  return false;
}

async function findAndClickFindTickets(
  page: Page,
  dateISO: string,
  venueName?: string,
  venueCity?: string,
  venueState?: string
) {
  const dateTexts = buildDateTextCandidates(dateISO);

  // let content render
  await page.waitForFunction(() => document.body && document.body.innerText.length > 1200, { timeout: 15000 });

  const clicked = await page.evaluate(
    ({ dateTexts, venueName, venueCity, venueState }) => {
      function matchesVenue(text: string) {
        let ok = true;
        const t = text.toLowerCase();
        if (venueName) ok = ok && t.includes(venueName.toLowerCase());
        if (venueCity) ok = ok && t.includes(venueCity.toLowerCase());
        if (venueState) ok = ok && t.includes(venueState.toLowerCase());
        return ok;
      }

      const containers = Array.from(document.querySelectorAll('section, li, div, article'))
        .filter(el => (el as HTMLElement).innerText && (el as HTMLElement).innerText.length > 40);

      // Prefer blocks that have "Find Tickets"
      const prioritized = containers.sort((a, b) => {
        const aHas = /find tickets/i.test(a.textContent || '');
        const bHas = /find tickets/i.test(b.textContent || '');
        return (bHas ? 1 : 0) - (aHas ? 1 : 0);
      });

      for (const el of prioritized) {
        const text = (el as HTMLElement).innerText || '';
        const hasDate = dateTexts.some(dt => text.includes(dt));
        if (!hasDate) continue;
        if (!matchesVenue(text)) continue;

        const btns = el.querySelectorAll<HTMLButtonElement>('button,[role="button"],a');
        for (const b of Array.from(btns)) {
          const label = (b.textContent || '').trim();
          if (/find tickets/i.test(label)) {
            (b as HTMLElement).scrollIntoView({ block: 'center' });
            (b as HTMLElement).click();
            return true;
          }
        }

        // fallback: any link in the tile
        const anyLink = el.querySelector<HTMLAnchorElement>('a[href]');
        if (anyLink) {
          (anyLink as HTMLElement).scrollIntoView({ block: 'center' });
          (anyLink as HTMLElement).click();
          return true;
        }
      }
      return false;
    },
    { dateTexts, venueName, venueCity, venueState }
  );

  if (!clicked) {
    // last resort: any "find tickets" on page
    try {
      await clickFirstVisibleButtonByText(page, ['find tickets'], 3500);
    } catch { /* ignore */ }
  }

  // allow SPA/nav settle
  try {
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch { /* SPA */ }
}

export async function runTicketmasterFlow(page: Page, siteDir: string) {
  const {
    ARTIST_NAME,
    EVENT_DATE,
    VENUE_NAME,
    VENUE_CITY,
    VENUE_STATE,
  } = process.env as Record<string, string | undefined>;

  if (!ARTIST_NAME) {
    console.warn('ARTIST_NAME not set; skipping Ticketmaster search flow.');
    return;
  }

  // Human-like idle after landing
  await humanPause(500, 1200);

  // Try to accept cookie/consent
  try {
    await clickFirstVisibleButtonByText(page, ['accept', 'agree', 'got it', 'continue', 'confirm', 'allow'], 3000);
    await humanPause();
  } catch { /* banner might not exist */ }

  // Focus search
  const searchSelectors = [
    'input[aria-label="Search"]',
    'input[type="search"]',
    'input[name="keyword"]',
    'input[placeholder*="Search"]',
    'input[id*="search"]',
  ];

  const typed = await typeIntoOneOf(page, searchSelectors, ARTIST_NAME, 35);
  if (!typed) {
    // If search input hidden behind an icon
    try {
      await clickFirstVisibleButtonByText(page, ['search'], 2500);
      await humanPause();
      await typeIntoOneOf(page, searchSelectors, ARTIST_NAME, 35);
    } catch { /* ignore */ }
  }

  await humanPause(250, 800);

  // Submit via Enter
  try {
    await page.keyboard.press('Enter');
  } catch { /* ignore */ }

  // Let results appear (looser waits)
  try {
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 });
  } catch { /* SPA */ }

  await humanPause(500, 1500);

  // Find the specific date/venue row and click Find Tickets
  if (EVENT_DATE) {
    await findAndClickFindTickets(page, EVENT_DATE, VENUE_NAME, VENUE_CITY, VENUE_STATE);
  } else {
    try {
      await clickFirstVisibleButtonByText(page, ['find tickets'], 6000);
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 });
    } catch { /* ignore */ }
  }

  // Small human think time, then save HTML + screenshot into the Ticketmaster folder
  await humanPause(700, 1600);

  await fs.mkdir(siteDir, { recursive: true });
  const ts = Date.now();
  const htmlPath = path.join(siteDir, `page_${ts}.html`);
  const pngPath = path.join(siteDir, `screenshot_${ts}.png`) as `${string}.png`;


  const html = await page.content();
  await fs.writeFile(htmlPath, html, 'utf8');
  console.log(`Saved HTML (TM flow): ${htmlPath}`);

  
  await page.screenshot({ path: pngPath, type: 'png', fullPage: true });
  console.log(`Saved screenshot (TM flow): ${pngPath}`);
}
