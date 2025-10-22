// vividseats.ts
import type { Page } from "puppeteer";

/** Click "Skip" if the modal appears, then ensure listings actually render. */
export async function waitForVividSeats(page: Page): Promise<void> {
  await dismissSeatCountIfPresent(page);

  // Wait for any likely inventory/listings XHR to finish (best-effort).
  await waitForInventoryResponse(page, 15000).catch(() => {});

  // Try to bring the listings region into view and trigger any lazy/virtual rendering.
  await nudgeListingsIntoView(page).catch(() => {});

  // Now wait for real evidence of listings: cards OR prices on the page, with no loaders.
  await waitForListingsDom(page, 25000);

  // A brief network calm period can help late assets settle.
  await waitForNetworkQuiet(page, { idleMs: 800, maxInflight: 2, timeoutMs: 10000 }).catch(() => {});
}

/* -------------------------- internals -------------------------- */

async function dismissSeatCountIfPresent(page: Page) {
  // Direct ARIA hit first
  const skip =
    (await page.$('[aria-label="Skip"]')) ||
    (await page.$('button[aria-label="Skip"]'));

  if (skip) {
    await skip.click().catch(() => {});
    return;
  }

  // Fallback: visible <button> with text "Skip"
  try {
    const clicked = await page.evaluate(() => {
      const isVisible = (el: Element) => {
        const s = window.getComputedStyle(el as HTMLElement);
        const r = (el as HTMLElement).getBoundingClientRect();
        return s.visibility !== "hidden" && s.display !== "none" && r.width > 0 && r.height > 0;
      };
      const btn = Array.from(document.querySelectorAll("button"))
        .find(b => b.textContent?.trim().toLowerCase() === "skip" && isVisible(b));
      (btn as HTMLButtonElement | undefined)?.click();
      return !!btn;
    });
    if (clicked) return;
  } catch {}

  // Last resort: ESC often closes overlays
  await page.keyboard.press("Escape").catch(() => {});
}

/** Wait for the inventory/listings request that powers the left pane. */
function waitForInventoryResponse(page: Page, timeoutMs: number) {
  // Match common inventory endpoints; loosened so it survives minor URL changes.
  const re = /(inventory|listings|tickets|offers|event-availability)/i;
  return page.waitForResponse(
    (res) => re.test(res.url()) && res.status() >= 200 && res.status() < 400,
    { timeout: timeoutMs }
  );
}

/** Scroll window and likely listings container to trigger virtualized mounts. */
async function nudgeListingsIntoView(page: Page) {
  await page.evaluate(async () => {
    // Heuristics to find the left column/list container.
    const candidates: HTMLElement[] = [];

    // obvious data-testids first
    document.querySelectorAll<HTMLElement>('[data-testid*="list"], [data-qa*="list"]').forEach(el => candidates.push(el));
    // columns likely
    document.querySelectorAll<HTMLElement>('aside, section, div').forEach(el => {
      if (el.innerText?.toLowerCase().includes('listings')) candidates.push(el);
    });

    const unique = Array.from(new Set(candidates)).filter(Boolean);
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

    // Scroll the window a bit to wake any intersection observers
    for (let i = 0; i < 4; i++) {
      window.scrollBy(0, 300);
      await sleep(120);
    }
    window.scrollTo({ top: 0 });

    // If we found a scrollable container, gently scroll it too
    const container =
      unique.find(el => el.scrollHeight > el.clientHeight + 40) ||
      unique.find(el => getComputedStyle(el).overflowY === 'auto') ||
      null;

    if (container) {
      for (let i = 0; i < 6; i++) {
        container.scrollTop += 200;
        await sleep(120);
      }
      container.scrollTop = 0;
    }
  });
}

/** Wait until (cards OR price text) AND no loaders, anywhere on the page. */
async function waitForListingsDom(page: Page, timeoutMs: number) {
  const listingSelectors = [
    '[data-testid="ticketCard"]',
    '[data-qa="ticket-card"]',
    '[data-testid="listing"]',
    '[data-qa="listing"]',
    // Some sites render items as <li role="listitem"> under a list
    'li[role="listitem"]',
  ];
  const loaderSelectors = [
    '[data-testid*="skeleton"]',
    '[class*="Skeleton"]',
    '[data-testid="loading"]',
    '[aria-busy="true"]',
    '[role="status"][aria-live="polite"]', // common spinner region
  ];

  await page.waitForFunction(
    (listingSelectors, loaderSelectors) => {
      const hasListing =
        listingSelectors.some(sel => document.querySelector(sel)) ||
        // A price-like pattern is a good cross-check when cards are virtualized:
        /\$\s*\d{1,3}(?:,\d{3})*(?:\.\d{2})?/.test(document.body.innerText);

      const loadersPresent = loaderSelectors.some(sel => document.querySelector(sel));
      return hasListing && !loadersPresent;
    },
    { polling: 250, timeout: timeoutMs },
    listingSelectors, loaderSelectors
  );
}

function waitForNetworkQuiet(
  page: import("puppeteer").Page,
  { idleMs = 800, maxInflight = 0, timeoutMs = 10_000 } = {}
) {
  return new Promise<void>((resolve, reject) => {
    let inflight = 0;
    let idleTimer: NodeJS.Timeout | null = null;
    let finished = false;

    const cleanup = () => {
      page.off("request", onRequest);
      page.off("requestfinished", onDone);
      page.off("requestfailed", onDone);
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    };

    const finish = (ok: boolean) => {
      if (finished) return;
      finished = true;
      cleanup();
      clearTimeout(timeout);
      ok ? resolve() : reject(new Error("waitForNetworkQuiet timed out"));
    };

    const onRequest = () => {
      inflight++;
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    };

    const onDone = () => {
      inflight = Math.max(0, inflight - 1);
      if (inflight <= maxInflight && !idleTimer) {
        idleTimer = setTimeout(() => finish(true), idleMs);
      }
    };

    page.on("request", onRequest);
    page.on("requestfinished", onDone);
    page.on("requestfailed", onDone);

    const timeout = setTimeout(() => finish(false), timeoutMs);
  });
}

