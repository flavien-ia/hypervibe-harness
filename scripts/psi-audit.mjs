#!/usr/bin/env node
// psi-audit.mjs : Runs a PageSpeed Insights audit (Lighthouse on Google's side) on
// one or more URLs and returns structured JSON on stdout.
//
// No external dependency (native fetch, Node >= 18).
//
// Usage :
//   PSI_KEY=<key> node psi-audit.mjs --urls "https://site.fr,https://site.fr/contact" [--strategy mobile|desktop] [--warmup]
//   node psi-audit.mjs --urls "..." --key <key>
//
// The key can come from --key OR from the PSI_KEY env variable (prefer the env so as
// not to expose the key on the command line / in the logs).
//
// Output (stdout) : { strategy, results: [ { url, ok, error?, scores, lab, field, opportunities, diagnostics } ] }
//   - scores      : { performance, accessibility, "best-practices", seo }  (0-100, or null)
//   - lab         : { fcp, lcp, tbt, cls, si }  (readable displayValue)
//   - field       : { hasData, overall, metrics: { LCP, CLS, INP, ... -> {p75, category} } }
//   - opportunities : [ { id, title, savingsMs } ]  sorted desc, savings > 50ms
//   - diagnostics   : [ { id, title, score } ]      failing audits (score < 0.9), excluding metrics/opportunities

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

function buildApiUrl(pageUrl, strategy, key) {
  const cats = ["performance", "accessibility", "best-practices", "seo"];
  const params = new URLSearchParams({ url: pageUrl, strategy, key });
  let u = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?" + params.toString();
  for (const c of cats) u += "&category=" + c;
  return u;
}

function extractResult(pageUrl, data) {
  const lr = data.lighthouseResult || {};
  const cats = lr.categories || {};
  const audits = lr.audits || {};

  const score = (k) => {
    const c = cats[k];
    return c && typeof c.score === "number" ? Math.round(c.score * 100) : null;
  };
  const scores = {
    performance: score("performance"),
    accessibility: score("accessibility"),
    "best-practices": score("best-practices"),
    seo: score("seo"),
  };

  const dv = (k) => (audits[k] && audits[k].displayValue) || null;
  const lab = {
    fcp: dv("first-contentful-paint"),
    lcp: dv("largest-contentful-paint"),
    tbt: dv("total-blocking-time"),
    cls: dv("cumulative-layout-shift"),
    si: dv("speed-index"),
  };

  const le = data.loadingExperience || {};
  const metrics = le.metrics || {};
  const field = {
    hasData: Object.keys(metrics).length > 0,
    overall: le.overall_category || null,
    metrics: Object.fromEntries(
      Object.entries(metrics).map(([k, v]) => [k, { p75: v.percentile, category: v.category }]),
    ),
  };

  const opportunities = [];
  for (const [id, a] of Object.entries(audits)) {
    const d = a.details || {};
    if (d.type === "opportunity" && (d.overallSavingsMs || 0) > 50) {
      opportunities.push({ id, title: a.title, savingsMs: Math.round(d.overallSavingsMs) });
    }
  }
  opportunities.sort((x, y) => y.savingsMs - x.savingsMs);

  const diagnostics = [];
  for (const [id, a] of Object.entries(audits)) {
    const s = a.score;
    const mode = a.scoreDisplayMode;
    const isOpp = (a.details || {}).type === "opportunity";
    if (typeof s === "number" && s < 0.9 && (mode === "binary" || mode === "numeric") && !isOpp) {
      diagnostics.push({ id, title: a.title, score: Number(s.toFixed(2)) });
    }
  }

  return {
    url: pageUrl,
    ok: true,
    lighthouseVersion: lr.lighthouseVersion || null,
    scores,
    lab,
    field,
    opportunities,
    diagnostics,
  };
}

async function auditOne(pageUrl, strategy, key, warmup) {
  if (warmup) {
    // Wakes the serverless function / CDN to avoid measuring a cold start.
    try { await fetchWithTimeout(pageUrl, 20000); } catch { /* best effort */ }
  }
  let lastErr = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const resp = await fetchWithTimeout(buildApiUrl(pageUrl, strategy, key), 120000);
      if (resp.status === 429) { lastErr = "429 rate-limited (missing key or quota exceeded)"; continue; }
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        let msg = `HTTP ${resp.status}`;
        try { const j = JSON.parse(body); if (j.error && j.error.message) msg += ` : ${j.error.message}`; } catch { /* */ }
        lastErr = msg;
        if (resp.status >= 500) continue; // retry on 5xx
        break;
      }
      const data = await resp.json();
      return extractResult(pageUrl, data);
    } catch (e) {
      lastErr = (e && e.name === "AbortError") ? "timeout (>120s)" : String((e && e.message) || e);
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
  if (args.urls.length > 8) args.urls = args.urls.slice(0, 8); // guardrail against quota blowup

  const results = [];
  for (const u of args.urls) {
    // Sequential on purpose : limits pressure on the quota and memory.
    results.push(await auditOne(u, args.strategy, args.key, args.warmup));
  }
  console.log(JSON.stringify({ strategy: args.strategy, results }, null, 2));
}

main().catch((e) => {
  console.log(JSON.stringify({ error: "fatal", message: String((e && e.message) || e) }));
  process.exit(1);
});
