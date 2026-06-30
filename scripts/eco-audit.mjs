#!/usr/bin/env node
// eco-audit.mjs : Eco-responsibility audit of a deployed site.
// Measures each URL via the PageSpeed Insights API (Lighthouse on Google's
// side), computes the EcoIndex score (open French methodology: DOM size,
// number of requests, KB transferred) + the associated impact estimate
// (gCO2e and water per visit, official EcoIndex formulas), and reports the
// breakdown of waste (images, unused JS, cache, third parties).
//
// No external dependency (native fetch, Node >= 18).
//
// Usage :
//   PSI_KEY=<key> node eco-audit.mjs --urls "https://site.fr,https://site.fr/page" [--strategy mobile|desktop] [--warmup]
//
// Output (stdout) : JSON
//   { strategy, results: [ {
//       url, ok, error?,
//       metrics:  { domElements, requests, transferKb },
//       ecoIndex: { score, grade, gesGrammes, waterCl },
//       waste:    { imagesKb, unusedJsKb, unusedCssKb, cacheKb },
//       thirdParties: [ {entity, transferKb} ],         // top 5
//       heaviest:     [ {url, kb} ],                    // top 5 resources
//       resourceBreakdown: [ {type, kb, requests} ]
//   } ] }
//
// Lighthouse 13+ compatibility : the historical audits migrated to
// "insights" (dom-size -> dom-size-insight, modern-image-formats ->
// image-delivery-insight, third-party-summary -> third-parties-insight,
// uses-long-cache-ttl -> cache-insight). We read the new names with a
// fallback on the old ones (verified in real conditions, LH 13.3.0).

function parseArgs(argv) {
  const args = { strategy: "mobile", warmup: false, urls: [], key: process.env.PSI_KEY || "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--urls") args.urls = (argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--strategy") args.strategy = (argv[++i] || "mobile").toLowerCase();
    else if (a === "--key") args.key = argv[++i] || "";
    else if (a === "--warmup") args.warmup = true;
    else if (a.startsWith("http")) args.urls.push(a);
  }
  return args;
}

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── EcoIndex (open methodology, official cnumr/ecoindex quantiles) ──
const Q_DOM = [0, 47, 75, 159, 233, 298, 358, 417, 476, 537, 603, 674, 753, 843, 949, 1076, 1237, 1459, 1801, 2479, 594601];
const Q_REQ = [0, 2, 15, 25, 34, 42, 49, 56, 63, 70, 78, 86, 95, 105, 117, 130, 147, 170, 205, 281, 3920];
const Q_KB = [0, 1.37, 144.7, 319.53, 479.46, 631.97, 783.38, 937.91, 1098.62, 1265.47, 1448.32, 1648.27, 1876.08, 2142.06, 2465.37, 2866.31, 3401.59, 4155.73, 5400.08, 8037.54, 223212.26];

function quantilePosition(quantiles, value) {
  for (let i = 1; i < quantiles.length; i++) {
    if (value < quantiles[i]) {
      return i - 1 + (value - quantiles[i - 1]) / (quantiles[i] - quantiles[i - 1]);
    }
  }
  return quantiles.length - 1;
}

function computeEcoIndex(domElements, requests, transferKb) {
  const qDom = quantilePosition(Q_DOM, domElements);
  const qReq = quantilePosition(Q_REQ, requests);
  const qKb = quantilePosition(Q_KB, transferKb);
  const score = Math.max(0, Math.round(100 - (5 * (3 * qDom + 2 * qReq + qKb)) / 6));
  const grade =
    score >= 81 ? "A" : score >= 71 ? "B" : score >= 56 ? "C" : score >= 41 ? "D" : score >= 26 ? "E" : score >= 11 ? "F" : "G";
  // Official EcoIndex impact formulas (estimates, per page visit) :
  const gesGrammes = Number((2 + (2 * (50 - score)) / 100).toFixed(2));
  const waterCl = Number((3 + (3 * (50 - score)) / 100).toFixed(2));
  return { score, grade, gesGrammes, waterCl };
}

// ─── Extraction from the Lighthouse result ─────────────────────────
const kb = (bytes) => Math.round((bytes || 0) / 1024);

function extract(url, data) {
  const lr = data.lighthouseResult || {};
  const a = lr.audits || {};
  const items = (k) => a[k]?.details?.items || [];

  // EcoIndex metrics
  const domElements =
    a["dom-size-insight"]?.numericValue ?? a["dom-size"]?.numericValue ?? 0;
  const totalRow = items("resource-summary").find(
    (i) => (i.resourceType || i.label) === "total" || i.label === "Total",
  );
  const requests = totalRow?.requestCount ?? items("network-requests").length;
  const transferBytes = totalRow?.transferSize ?? a["total-byte-weight"]?.numericValue ?? 0;
  const transferKb = kb(transferBytes);

  // Waste (estimated savings)
  const sumWasted = (k) => kb(items(k).reduce((s, i) => s + (i.wastedBytes || 0), 0));
  const waste = {
    imagesKb: sumWasted("image-delivery-insight") || sumWasted("modern-image-formats"),
    unusedJsKb: sumWasted("unused-javascript"),
    unusedCssKb: sumWasted("unused-css-rules"),
    cacheKb: sumWasted("cache-insight") || sumWasted("uses-long-cache-ttl"),
  };

  // Third-party scripts/resources (top 5 by weight)
  const tpItems = items("third-parties-insight").length
    ? items("third-parties-insight")
    : items("third-party-summary");
  const thirdParties = tpItems
    .map((i) => ({ entity: i.entity?.text || i.entity || "?", transferKb: kb(i.transferSize) }))
    .filter((t) => t.transferKb > 0)
    .sort((x, y) => y.transferKb - x.transferKb)
    .slice(0, 5);

  // The 5 heaviest resources
  const heaviest = items("total-byte-weight")
    .map((i) => ({ url: i.url, kb: kb(i.totalBytes) }))
    .sort((x, y) => y.kb - x.kb)
    .slice(0, 5);

  // Breakdown by type (images, scripts, fonts...)
  const resourceBreakdown = items("resource-summary")
    .filter((i) => (i.resourceType || "") !== "total" && i.label !== "Total")
    .map((i) => ({ type: i.label || i.resourceType, kb: kb(i.transferSize), requests: i.requestCount }))
    .filter((r) => r.kb > 0)
    .sort((x, y) => y.kb - x.kb);

  return {
    url,
    ok: true,
    lighthouseVersion: lr.lighthouseVersion || null,
    metrics: { domElements, requests, transferKb },
    ecoIndex: computeEcoIndex(domElements, requests, transferKb),
    waste,
    thirdParties,
    heaviest,
    resourceBreakdown,
  };
}

async function auditOne(pageUrl, strategy, key, warmup) {
  if (warmup) {
    try { await fetchWithTimeout(pageUrl, 20000); } catch { /* best effort */ }
  }
  const params = new URLSearchParams({ url: pageUrl, strategy, key });
  const api =
    "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?" + params.toString() + "&category=performance";
  let lastErr = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const resp = await fetchWithTimeout(api, 120000);
      if (resp.status === 429) { lastErr = "429 rate-limited (missing key or quota exceeded)"; continue; }
      if (!resp.ok) {
        lastErr = `HTTP ${resp.status}`;
        if (resp.status >= 500) continue;
        break;
      }
      return extract(pageUrl, await resp.json());
    } catch (e) {
      lastErr = e && e.name === "AbortError" ? "timeout (>120s)" : String((e && e.message) || e);
    }
  }
  return { url: pageUrl, ok: false, error: lastErr };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.key) {
    console.log(JSON.stringify({ error: "no_key", message: "No PSI key (PSI_KEY env or --key)." }));
    process.exit(2);
  }
  if (args.urls.length === 0) {
    console.log(JSON.stringify({ error: "no_urls", message: "No URL provided (--urls)." }));
    process.exit(2);
  }
  if (args.urls.length > 8) args.urls = args.urls.slice(0, 8); // quota guard rail

  const results = [];
  for (const u of args.urls) {
    // Intentionally sequential : limits pressure on the quota.
    results.push(await auditOne(u, args.strategy, args.key, args.warmup));
  }
  console.log(JSON.stringify({ strategy: args.strategy, results }, null, 2));
}

main().catch((e) => {
  console.log(JSON.stringify({ error: "fatal", message: String((e && e.message) || e) }));
  process.exit(1);
});
