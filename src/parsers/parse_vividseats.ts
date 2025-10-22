// src/parsers/parse_vividseats.ts
export type VividSeatsStats = {
  prices: number[];
  count: number;
  avg: number;
  median: number;
  min: number;
};

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function toNum(v: unknown): number | undefined {
  if (v === null || v === undefined) return;
  const n = typeof v === 'string' ? Number(v.replace(/,/g, '')) : Number(v);
  if (!Number.isFinite(n)) return;
  if (n < 1 || n > 5000) return; // sensible ticket-range guard
  return n;
}

function safeJSON<T = any>(s: string): T | undefined {
  try { return JSON.parse(s) as T; } catch { return undefined; }
}

export function parseVividSeats(html: string): VividSeatsStats {
  const prices: number[] = [];

  // 1) Prefer ld+json (aggregate offers, price/lowPrice/highPrice)
  const ldjsonRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(ldjsonRe)) {
    const blob = (m[1] || '').trim();
    const data = safeJSON<any>(blob);
    if (!data) continue;

    // AggregateOffer style
    const agg = data?.aggregateOffer || data?.offers?.aggregateOffer || data?.offers;
    if (agg && typeof agg === 'object') {
      for (const key of ['price', 'lowPrice', 'highPrice']) {
        const n = toNum((agg as any)[key]);
        if (n !== undefined) prices.push(n);
      }
    }

    // Plain offers array/object
    const offers = Array.isArray(data?.offers) ? data.offers : (data?.offers ? [data.offers] : []);
    for (const off of offers) {
      for (const k of ['price', 'lowPrice', 'highPrice', 'minPrice', 'maxPrice']) {
        const n = toNum(off?.[k]);
        if (n !== undefined) prices.push(n);
      }
      const spec = off?.priceSpecification;
      if (spec) {
        const n = toNum(spec.price);
        if (n !== undefined) prices.push(n);
      }
    }
  }

  // 2) Any inline script JSON with "price"/"minPrice"/"maxPrice"
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(scriptRe)) {
    const js = m[1] || '';
    for (const m2 of js.matchAll(/"(?:price|minPrice|maxPrice|lowPrice|highPrice)"\s*:\s*"?([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)"?/g)) {
      const n = toNum(m2[1]);
      if (n !== undefined) prices.push(n);
    }
  }

  // 3) Fallback: visible $xx.xx anywhere in the HTML
  const dollars = /\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/g;
  for (const m of html.matchAll(dollars)) {
    const n = toNum(m[1]);
    if (n !== undefined) prices.push(n);
  }

  // Keep all hits (we treat them as listings); dedupe only if you want unique price points
  const xs = prices;
  const count = xs.length;
  const avg = count ? xs.reduce((a, b) => a + b, 0) / count : 0;
  const med = median(xs);
  const mn = count ? Math.min(...xs) : 0;

  return { prices: xs, count, avg, median: med, min: mn };
}
