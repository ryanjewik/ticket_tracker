import puppeteer from "puppeteer-extra";
import type { Browser } from 'puppeteer';
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

puppeteer.use(StealthPlugin());


const BROWSER_WEBSOCKET_ENDPOINT = process.env.BRIGHT_DATA_SCRAPING_BROWSER_WEBSOCKET_ENDPOINT;

// Exported function so it can be scheduled by a separate scheduler.
export async function runScrape(url: string, site?: string): Promise<void> {
    if (!url) throw new Error('runScrape requires a URL');
    const siteSlug = (site || 'unknown').toLowerCase().replace(/[^a-z0-9-_]/g, '_');
    console.log(`🚀 Starting the scraping process for ${siteSlug} — ${url}`);
    let browser: Browser | undefined;
    try {
        console.log("🌐 Connecting to the Scraping Browser...");
        browser = await puppeteer.connect({
            browserWSEndpoint: BROWSER_WEBSOCKET_ENDPOINT,
        });
        console.log("✅ Successfully connected to the browser!");

        const page = await browser.newPage();
        console.log("🌍 Navigating to the target URL...");

        await page.setViewport({ width: 1366, height: 768, deviceScaleFactor: 1 });

        // Make sure the DOM has laid out
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 });
        await page.waitForSelector('body', { timeout: 15_000 });

        // (optional) sanity check & fallback
        const size = await page.evaluate(() => ({
            w: document.documentElement.clientWidth,
            h: document.documentElement.clientHeight,
        }));
        if (!size.w || !size.h) {
            // Force a known-good viewport if still zero
            await page.setViewport({ width: 1366, height: 768, deviceScaleFactor: 1 });
            await page.waitForFunction(
                () => document.documentElement.clientWidth > 0,
                { timeout: 10_000 }
            );
        }

        const client = await page.createCDPSession();

        // 'Captcha.waitForSolve' is a non-standard/untyped CDP command for this project.
        // Puppeteer's CDP `send` is strongly typed and doesn't include this command, so
        // cast to `any` and check the response at runtime.
        const captchaResult = await (client as any).send('Captcha.waitForSolve', {
            detectTimeout: 10 * 1000,
        }) as { status?: string } | undefined;
        const status = captchaResult?.status ?? 'unknown';
        console.log(`Captcha status: ${status}`);

        console.log("📸 Taking a screenshot of the page...");
            function getPstTimestamp() {
                const now = new Date();
                const parts = new Intl.DateTimeFormat('en-US', {
                    timeZone: 'America/Los_Angeles',
                    year: 'numeric', month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                    hour12: false,
                }).formatToParts(now).reduce((acc: any, part) => {
                    if (part.type !== 'literal') acc[part.type] = part.value;
                    return acc;
                }, {});
                const ms = String(now.getMilliseconds()).padStart(3, '0');
                // Format: YYYY-MM-DDTHH-mm-ss-SSS (using hyphens instead of colons)
                return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}-${parts.minute}-${parts.second}-${ms}`;
            }

            const timestamp = getPstTimestamp();
            const artifactsDir = path.join(process.cwd(), 'artifacts', siteSlug, timestamp);
        fs.mkdirSync(artifactsDir, { recursive: true });
        const screenshotPath = path.join(artifactsDir, 'page.png');
        const screenshotBuffer = await page.screenshot({ fullPage: true }) as Buffer;
        fs.writeFileSync(screenshotPath, screenshotBuffer);
        console.log(`✅ Screenshot saved as '${screenshotPath}'!`);

        console.log("🔍 Scraping page content...");
        const html = await page.content();
        const htmlPath = path.join(artifactsDir, 'page.html');
        fs.writeFileSync(htmlPath, html, { encoding: 'utf8' });
        console.log(`✅ HTML saved as '${htmlPath}'!`);
    } catch (error) {
        console.error("❌ An error occurred during scraping:");
        // `error` is `unknown` in TS. Narrow it safely before accessing properties.
        if (error instanceof Error) {
            console.error(error.message);
            console.error(error.stack);
        } else {
            console.error(String(error));
        }
    } finally {
        if (browser) {
            await browser.close();
            console.log("👋 Browser closed.");
        }
    }
}

// If run directly (node src/index.ts or ts-node src/index.ts), execute once.
if (require.main === module) {
    (async () => {
        // If run directly, run all configured URLs (if present) in sequence.
        const urls: Array<{ url: string; site: string }> = [];
        if (process.env.STUBHUB_URL) urls.push({ url: process.env.STUBHUB_URL, site: 'stubhub' });
        if (process.env.VIVIDSEATS_URL) urls.push({ url: process.env.VIVIDSEATS_URL, site: 'vividseats' });
        if (process.env.TICKETMASTER_URL) urls.push({ url: process.env.TICKETMASTER_URL, site: 'ticketmaster' });
        if (process.env.SEATGEEK_URL) urls.push({ url: process.env.SEATGEEK_URL, site: 'seatgeek' });

        for (const entry of urls) {
            await runScrape(entry.url, entry.site);
            // small delay between runs to avoid burst behaviour
            await new Promise((res) => setTimeout(res, 1500 + Math.random() * 2000));
        }
    })();
}
