import puppeteer from "puppeteer-extra";
import type { Browser } from 'puppeteer';
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

puppeteer.use(StealthPlugin());


const BROWSER_WEBSOCKET_ENDPOINT = process.env.BRIGHT_DATA_SCRAPING_BROWSER_WEBSOCKET_ENDPOINT;
const PAGE_URL = process.env.VIVIDSEATS_URL;

if (!PAGE_URL) {
    throw new Error('Environment variable VIVIDSEATS_URL (PAGE_URL) must be set');
}

// Exported function so it can be scheduled by a separate scheduler.
export async function runScrape(): Promise<void> {
    console.log("🚀 Starting the scraping process...");
    let browser: Browser | undefined;
    try {
        console.log("🌐 Connecting to the Scraping Browser...");
        browser = await puppeteer.connect({
            browserWSEndpoint: BROWSER_WEBSOCKET_ENDPOINT,
        });
        console.log("✅ Successfully connected to the browser!");

        const page = await browser.newPage();
        console.log("🌍 Navigating to the test URL...");

        // after: const page = await browser.newPage();
        await page.setViewport({ width: 1366, height: 768, deviceScaleFactor: 1 });

        // Make sure the DOM has laid out
        await page.goto(PAGE_URL!, { waitUntil: 'networkidle2', timeout: 60_000 });
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

        // now it’s safe to screenshot
        await page.screenshot({ path: 'page.png', fullPage: true, captureBeyondViewport: true });

        const client = await page.createCDPSession();
        // PAGE_URL is checked above; use non-null assertion to satisfy TS
        await page.goto(PAGE_URL!, { timeout: 2 * 60 * 1000 });

        // 'Captcha.waitForSolve' is a non-standard/untyped CDP command for this project.
        // Puppeteer's CDP `send` is strongly typed and doesn't include this command, so
        // cast to `any` and check the response at runtime.
        const captchaResult = await (client as any).send('Captcha.waitForSolve', {
            detectTimeout: 10 * 1000,
        }) as { status?: string } | undefined;
        const status = captchaResult?.status ?? 'unknown';
        console.log(`Captcha status: ${status}`);

    console.log("📸 Taking a screenshot of the page...");
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const artifactsDir = path.join(process.cwd(), 'artifacts', timestamp);
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
    // Allow an env var to run immediately on start for quick manual runs.
    (async () => {
        await runScrape();
    })();
}
