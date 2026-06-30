---
name: _setup-indexnow
description: Internal helper to set up IndexNow (proactive URL submission to Bing, Yandex, Seznam) on a Next.js project. Generates the proof key, drops the verification file in /public, creates a reusable helper, and wires the ping to the project's publication event (cron, postbuild, webhook, or manual CLI). Triggered by /geo when the user has content that publishes regularly. Not meant to be invoked directly by users.
user-invocable: false
allowed-tools: Bash, Read, Edit, Write
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# Setup IndexNow - Internal helper

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

You set up IndexNow on the current project.

IndexNow is a protocol created by Microsoft (Bing) and adopted by Yandex, Seznam, and Cloudflare. When a new page is published, the site **POSTs the URL** to `api.indexnow.org`, and participating engines index it within minutes instead of several days. Bing relays this signal to Copilot and ChatGPT search. Google does not support IndexNow.

⚠️ **Precondition**: this skill assumes the caller (`/geo`) has already confirmed that the project publishes content regularly. If you are called without clear context, ask the user before continuing.

---

## Step 1 - Generate the key and drop the proof file

```bash
KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
PUBLIC_DIR="$(test -d apps/web/public && echo apps/web/public || echo public)"
printf "%s\n" "$KEY" > "$PUBLIC_DIR/$KEY.txt"
echo "Key file: $PUBLIC_DIR/$KEY.txt"
echo "Key value: $KEY"
```

The file name **is** the key - this is IndexNow's proof mechanism. The key is public by design (it proves you control the domain, it is not a secret). The file is committed to the repo.

## Step 2 - Create a reusable helper

Detect the structure:
- **Monorepo with worker / pipeline** (e.g. `packages/pipeline/`) → put the helper in `packages/<pkg>/src/utils/index-now.ts`
- **Next.js single app** → put the helper in `src/lib/index-now.ts` or `apps/web/src/lib/index-now.ts`

Helper contents (adapt the `INDEXNOW_KEY` and the `INDEXNOW_HOST`):

```typescript
/**
 * IndexNow - push fresh URLs to Bing, Yandex, Seznam, and other
 * participating search engines. Bing relays signals to Copilot and
 * ChatGPT search.
 *
 * Google does NOT support IndexNow - for Google we still rely on the
 * sitemap + organic crawl.
 */
const INDEXNOW_KEY = "<KEY_GENERATED_ABOVE>";
const INDEXNOW_HOST = "<your-domain.fr>";
const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

export async function pingIndexNow(urls: string[]): Promise<void> {
  if (urls.length === 0) return;

  const payload = {
    host: INDEXNOW_HOST,
    key: INDEXNOW_KEY,
    keyLocation: `https://${INDEXNOW_HOST}/${INDEXNOW_KEY}.txt`,
    urlList: urls,
  };

  try {
    const response = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
    });

    // 200 = accepted, 202 = accepted (async), 422 = some URLs invalid
    // (the valid ones are still queued). Any other code = batch rejected.
    if (![200, 202].includes(response.status)) {
      console.warn(`[index-now] HTTP ${response.status} for ${urls.length} URLs`);
      return;
    }
    console.log(`[index-now] Submitted ${urls.length} URL(s)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[index-now] Submission failed: ${message}`);
  }
}
```

## Step 3 - Wire the ping to a publication event

The wiring **depends on the project's architecture**. Detect and propose:

- **Pipeline / worker (cron that publishes content)** → call `pingIndexNow([...urls])` at the end of the publication step, after the "published" status is set in the DB. Include: home, section/landing page, archives, and the URL of the new page.
- **Static build (Next.js MDX, Astro, etc.)** → add a `postbuild` script that parses the sitemap and pings all URLs (or only those whose `lastmod` is recent). Example `package.json`: `"postbuild": "node scripts/indexnow-from-sitemap.mjs"`.
- **Headless CMS with a webhook (Strapi, Sanity, Contentful)** → create a `/api/webhooks/published` route (HMAC-protected) that receives the CMS webhook and calls `pingIndexNow` with the published URL.
- **Site without automated publishing** → provide a `pnpm indexnow:ping <url>...` CLI script that the user can run manually after each update.

**Ask the user which one applies** before wiring. For projects with a custom pipeline, **read** the publication code, identify the right insertion point, and propose a precise patch before applying it.

## Step 4 - Test

After wiring, run a test:

```bash
curl -X POST https://api.indexnow.org/indexnow \
  -H "Content-Type: application/json" \
  -d '{"host":"<domain>","key":"<KEY>","keyLocation":"https://<domain>/<KEY>.txt","urlList":["https://<domain>/"]}'
```

Expected response: HTTP 200 or 202. Any other code = check the proof file, the `host`, and the `key`.

## Step 5 - Return to the caller

Confirm to the user that IndexNow is in place and summarize:
- Key generated + proof file dropped
- Helper created at `<path>`
- Wiring chosen (pipeline / postbuild / webhook / manual)
- Test passed

Then hand back to `/geo` (which continues with 3g).
