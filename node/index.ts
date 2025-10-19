import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

async function run() {
    let browser;
    try {
        // proxy credentials and host
        const proxyUser = '';
        const proxyPass = '';
        const proxyHost = '';

        // construct proxy URL with credentials (upstream BrightData)
        const proxyUrl = `http://${proxyUser}:${proxyPass}@${proxyHost}`;

        // Use proxy-chain to create a local anonymous proxy which forwards to BrightData with credentials.
        // This avoids dealing with WebSocket CONNECT auth for puppeteer.connect and lets Chrome send all
        // page requests through the upstream residential proxy.
    // require used instead of import to avoid TypeScript missing declaration issues
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ProxyChain = require('proxy-chain');
    const localProxyUrl = await ProxyChain.anonymizeProxy(proxyUrl);

        // Launch a local browser that uses the local proxy server created by proxy-chain
        // apply stealth plugin
        puppeteer.use(StealthPlugin());

        browser = await puppeteer.launch({
            args: [
                `--no-sandbox`,
                `--disable-setuid-sandbox`,
                `--proxy-server=${localProxyUrl}`,
                `--ignore-certificate-errors`
            ],
            headless: true,
            ignoreHTTPSErrors: true
        } as any);

        const page = await browser.newPage();
        // set a realistic user agent and language headers
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9'
        });
        // small human-like actions
        await page.setViewport({ width: 1366, height: 768 });
        page.setDefaultNavigationTimeout(2 * 60 * 1000); // 2 minutes

    await page.goto('https://seatgeek.com/lamp-tickets/anaheim-california-house-of-blues-anaheim-2025-11-07-7-pm/concert/17643569', { waitUntil: 'domcontentloaded' });

    // small interactions to appear more human
    await page.mouse.move(100, 100);
    await new Promise((res) => setTimeout(res, 800 + Math.floor(Math.random() * 400)));


        const body = await page.$('body');


        const html = await page.evaluate(() => document.documentElement.outerHTML);

        // ensure scraper_output directory exists and save the HTML
        const fs = await import('fs');
        const path = await import('path');

        const outDir = path.resolve(__dirname, '..', 'scraper_output');
        const outFile = path.join(outDir, 'seatgeek_last_page_source.html');

        try {
            if (!fs.existsSync(outDir)) {
                fs.mkdirSync(outDir, { recursive: true });
            }
            fs.writeFileSync(outFile, html, { encoding: 'utf8' });
            console.log('Saved HTML to', outFile);
        } catch (fsErr) {
            console.error('Failed to write HTML file:', fsErr);
        }

        return;
    } catch (error) {
        console.error('Error connecting to browser:', error);
    } finally {
        await browser?.close();
    }
}
run()