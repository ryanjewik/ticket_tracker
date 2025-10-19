#!/usr/bin/env node
const puppeteer = require('puppeteer-core');
const {
    AUTH = '',
    TARGET_URL = 'https://www.stubhub.com/lamp-anaheim-tickets-11-7-2025/event/159015267/?quantity=0',
} = process.env;

async function scrape(url = TARGET_URL) {
    if (AUTH == '') {
        throw new Error(`Provide Browser API credentials in AUTH`
            + ` environment variable or update the script.`);
    }
    console.log(`Connecting to Browser...`);
    const browserWSEndpoint = `wss://${AUTH}@brd.superproxy.io:9222`;
    const browser = await puppeteer.connect({ browserWSEndpoint });
    try {
        console.log(`Connected! Navigating to ${url}...`);
        const page = await browser.newPage();
        const client = await page.createCDPSession();
        await page.goto(url, { timeout: 2 * 60 * 1000 });
        console.log(`Navigated! Waiting captcha to detect and solve...`);
        const { status } = await client.send('Captcha.waitForSolve', {
            detectTimeout: 10 * 1000,
        });
        console.log(`Captcha status: ${status}`);
    } finally {
        await browser.close();
    }
}

function getErrorDetails(error) {
    if (error.target?._req?.res) {
        const {
            statusCode,
            statusMessage,
        } = error.target._req.res;
        return `Unexpected Server Status ${statusCode}: ${statusMessage}`;
    }
}

if (require.main == module) {
    scrape().catch(error => {
        console.error(getErrorDetails(error)
            || error.stack
            || error.message
            || error);
        process.exit(1);
    });
}