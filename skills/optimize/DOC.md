# /optimize

Finds what is expensive in your application, on the server side, and fixes it. Queries that bring back too much data, screens that keep polling the database, missing caching, files served from the database: every finding is quantified, ranked by real cost, and fixed only if you approve it.

## When to use it

- You received a **quota alert** on one of your services (database, storage, hosting)
- Your application **consumes** more than its traffic would suggest
- You want a **periodic checkup**, before the meter climbs too high
- You just finished a large feature and want to know what it costs

## How it works

1. **Measure first, read the code after**: Hypervibe starts by looking at what your services actually consume, and how fast. Without that figure, a flaw found in the code means nothing. It is also what makes it possible to rank findings by cost rather than by order of appearance.

2. **Search for the known causes**: seven families of problems are reviewed.
  - **Oversized queries** (asking the database for everything when the screen only shows a few columns)
  - **Endless refreshing** (a screen that keeps querying the database even when nothing is happening)
  - **Missing caching** (a public page recomputed on every visit instead of being served as is)
  - **Files stored in the database** (images, PDFs, archives, which cost far more there than on dedicated storage)
  - **Cascading queries** (a list that triggers one query per item displayed)
  - **Work redone on every visit** (a heavy computation that could be kept in memory)
  - **Too much work handed to the browser** (interface pieces that could have been prepared on the server)

3. **Focused reading of the hot spots**: Hypervibe actually reads the most expensive files, to find what no automated search can see. This is where the most absurd cases turn up, such as data fetched every fifteen seconds and displayed nowhere.

4. **Quantified report**: for each finding, you see:
  - **What it is**, in plain language, no jargon
  - **Confidence level** (what Hypervibe checked to be sure)
  - **How risky the fix is** (what could break, and how you would notice)
  - **Estimated gain**, in megabytes per day or gigabytes per month, with the arithmetic
  - **The proposed fix**, in one sentence

5. **You approve one finding at a time**: never in bulk. On anything that affects how live a screen feels, Hypervibe asks you rather than deciding for you.

6. **Applied on a separate branch**: one fix per approval, automatic code checks, then you test before merging.

## What it creates for you

- An `optimize-*` branch with the approved fixes, one by one, each revertible on its own
- A readable report of what your application consumes and what is left to gain
- A reference figure to compare against a few days later, to confirm it worked

## Requirements

- No particular requirement, `/optimize` runs on any project built with the plugin
- If there is no database, the families that concern it are simply skipped, and Hypervibe tells you so
- Better to have a clean Git state before starting, so your work in progress does not get mixed with the fixes

## Tips

{{callout:info|It is not the size of your database that costs, it is the number of reads}}
This is the least intuitive point, and the one that catches everyone out. Your allowance does not count "how big is my database", it counts "how much did it send out". A tiny database read a thousand times a day costs far more than a big one read ten times. That is why a project with no traffic at all can eat the allowance of all your other projects.
{{/callout}}

{{callout:warning|A page you believe is cached may not be}}
This is the most expensive case, and the sneakiest. A page can be configured to be recomputed only once an hour, and still be recomputed on every single visit, because of a technical detail that cancels the setting without warning. Nobody notices: the page works, it is just far more expensive. It matters most on pages pulled by machines continuously (RSS, podcast, sitemap), which are hit day and night. A real case measured on this stack: a podcast feed that believed it was cached consumed close to 200 MB a day on its own.
{{/callout}}

{{callout:warning|A tab forgotten on a second screen consumes all day}}
A dashboard left open keeps querying your database even if nobody is looking at it: as far as the browser is concerned, a tab visible on a secondary screen is still visible. This is one of the most frequent causes of an unexpected bill, and one of the easiest to fix.
{{/callout}}

{{callout:tip|A snappier screen never comes from refreshing faster}}
If you want a screen to react instantly, the right answer is to notify it when something changes, not to make it ask more often. Hypervibe will always offer that route first.
{{/callout}}

{{callout:info|The difference with /eco-audit and /clean}}
`/eco-audit` looks at what the browser downloads and renders (images, scripts, perceived speed). `/clean` looks for what is no longer used and can be deleted. `/optimize` looks at what the server does and what it consumes. The three are complementary and do not overlap.
{{/callout}}
