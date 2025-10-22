// src/parsers/parse_ticketmaster.ts
export type TicketmasterStats = {
  prices: number[];
  count: number;
  avg: number;
  median: number;
  min: number;
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const xs = [...values].sort((a, b) => a - b);
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

// Safely parse JSON blobs; return undefined on failure
function safeJSON<T = any>(s: string): T | undefined {
  try { return JSON.parse(s) as T; } catch { return undefined; }
}

export function parseTicketmaster(html: string): TicketmasterStats {
  const prices: number[] = [];

  // ---------- 1) Pull prices from <script type="application/ld+json"> ----------
  // Ticketmaster commonly exposes "offers": { lowPrice, highPrice, price, priceCurrency, ... }
  const ldjsonRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(ldjsonRe)) {
    const blob = (m[1] || "").trim();
    const data = safeJSON<any>(blob);
    if (!data) continue;

    // a) offers as an object or array
    const offers = Array.isArray(data?.offers) ? data.offers : (data?.offers ? [data.offers] : []);
    for (const off of offers) {
      const cands = [
        off?.price, off?.lowPrice, off?.highPrice, off?.priceSpecification?.price,
      ].filter(v => v !== undefined && v !== null);
      for (const v of cands) {
        const num = typeof v === "string" ? Number(v.replace(/,/g, "")) : Number(v);
        if (Number.isFinite(num) && num >= 1 && num <= 5000) prices.push(num);
      }
    }

    // b) sometimes price/priceRange is nested under "aggregateOffer" or similar
    const agg = data?.aggregateOffer || data?.offers?.aggregateOffer;
    if (agg) {
      for (const k of ["lowPrice","highPrice","price"]) {
        const v = agg[k];
        const num = typeof v === "string" ? Number(v.replace(/,/g, "")) : Number(v);
        if (Number.isFinite(num) && num >= 1 && num <= 5000) prices.push(num);
      }
    }
  }

  // ---------- 2) Pull prices from any inline JSON (Next.js __NEXT_DATA__, window.__APOLLO_STATE__, etc.) ----------
  // Grab <script>...</script> blocks and look for `"price": "123.45"` or `"minPrice": 123.45`
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(scriptRe)) {
    const js = m[1] || "";

    // "price": "123.45" or "price": 123.45
    for (const m2 of js.matchAll(/"price"\s*:\s*"?([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)"?/g)) {
      const num = Number(m2[1].replace(/,/g, ""));
      if (Number.isFinite(num) && num >= 1 && num <= 5000) prices.push(num);
    }
    // "minPrice": ..., "maxPrice": ...
    for (const m3 of js.matchAll(/"(?:minPrice|maxPrice|lowPrice|highPrice)"\s*:\s*"?([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)"?/g)) {
      const num = Number(m3[1].replace(/,/g, ""));
      if (Number.isFinite(num) && num >= 1 && num <= 5000) prices.push(num);
    }
  }

  // ---------- 3) Fallback: visible $xx.xx in the HTML ----------
  // This catches server-side rendered price text if present
  const dollarsRe = /\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/g;
  for (const m of html.matchAll(dollarsRe)) {
    const num = Number(m[1].replace(/,/g, ""));
    if (Number.isFinite(num) && num >= 1 && num <= 5000) prices.push(num);
  }

  // If you want to dedupe repeat values (some blobs repeat), you can Set() here:
  // const uniq = Array.from(new Set(prices));
  const uniq = prices;

  const count = uniq.length;
  const avg = count ? uniq.reduce((a, b) => a + b, 0) / count : 0;
  const med = median(uniq);
  const mn = count ? Math.min(...uniq) : 0;

  return { prices: uniq, count, avg, median: med, min: mn };
}
