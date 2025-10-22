export async function waitForTicketmasterState(page: any): Promise<'inventory'|'unavailable'|'unknown'> {
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
