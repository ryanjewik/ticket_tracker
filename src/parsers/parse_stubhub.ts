// src/parsers/parse_stubhub.ts
export type StubhubStats = {
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

export function parseStubhub(html: string): StubhubStats {
  // 1) Grab $xx.xx patterns (handles commas too)
  const priceRegex = /\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/g;
  const pricesRaw: number[] = [];
  for (const m of html.matchAll(priceRegex)) {
    const num = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(num)) continue;
    // Heuristics: accept reasonable ticket prices only
    if (num < 1 || num > 5000) continue;
    pricesRaw.push(num);
  }

  // 2) Deduplicate obviously repeated strings (optional)
  // Many pages repeat same listing snippet; keep them all for "listings count".
  // If you prefer unique price points, use: const prices = [...new Set(pricesRaw)];
  const prices = pricesRaw;

  const count = prices.length;
  const avg = count ? prices.reduce((a, b) => a + b, 0) / count : 0;
  const med = median(prices);
  const mn = count ? Math.min(...prices) : 0;

  return { prices, count, avg, median: med, min: mn };
}
