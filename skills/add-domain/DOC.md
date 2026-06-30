# /add-domain

Connects a **custom domain name** to your app: `mysite.com` instead of `mysite.vercel.app`.

## When to use it

- You want your site to be accessible at **your own address** (more professional, better ranked, more credible)
- You just bought a domain and you want to connect it to your project
- You also want to receive emails on your domain (`contact@mysite.com`) without creating a real mailbox

## How it works

The target architecture: **your registrar → Cloudflare (DNS + Email Routing) → Vercel (hosting)**. Cloudflare in the middle provides fast DNS, free DDoS protection, and email routing (receiving at `contact@mysite.com` redirected to your Gmail).

1. **Domain bought or not?** If you don't have one yet, Hypervibe recommends Hostinger (French UI/support, .fr supported, easy automation). You buy it in a few minutes.

2. **Identifying the registrar**: where is the domain registered? Hypervibe handles Hostinger, Cloudflare, OVH, Namecheap, GoDaddy (manual for the latter, their API does not allow automation).

3. **Cloudflare check**: Hypervibe checks that your Cloudflare token is valid. Otherwise, it sends you back to `/start`.

4. **Creating the Cloudflare zone**: Hypervibe adds your domain to your Cloudflare account and retrieves the **2 assigned nameservers**.

5. **Changing the nameservers at the registrar**: depending on your registrar, Hypervibe calls its API directly (Hostinger, OVH, Namecheap, Gandi, Porkbun…) with your access key stored in your vault, and pushes the new nameservers. For registrars without a public API (GoDaddy, IONOS…), you'll do it by hand (clear instructions provided).

6. **Configuring the DNS records**: Hypervibe deletes the old records and adds the Vercel ones (`A` apex → 76.76.21.21, `CNAME` www → `cname.vercel-dns.com`).

7. **Connecting to Vercel**: Hypervibe adds the domain on the Vercel side (via `vercel domains add`).

8. **Updating the URL in the code**: `NEXT_PUBLIC_APP_URL` is updated everywhere, and all references to `*.vercel.app` in the code (sitemap, metadata, JSON-LD, robots.txt, legal pages) are replaced by your new domain, crucial for SEO.

9. **Email Routing (optional)**: Hypervibe offers to set up receiving emails on your domain. If yes, it delegates to `/new-email-address` to create a first address (for example `contact@mysite.com` → your Gmail).

10. **Resend (optional)**: if Resend is already configured on the project, Hypervibe also offers to switch the email sending to your new domain (`contact@mysite.com` instead of `onboarding@resend.dev`).

11. **Commit + deploy**: the code changes are committed and pushed to redeploy.

## What it creates for you

- A **Cloudflare zone** for your domain, with the registrar's nameservers pointing to it
- The **Vercel DNS records** (A apex + CNAME www) configured in Cloudflare
- The domain **added to your Vercel project** with an automatic HTTPS certificate
- The `NEXT_PUBLIC_APP_URL` variable updated everywhere (Vercel + `.env` + source code)
- If you want: **receiving emails** on your domain (via Cloudflare Email Routing)
- If you want: **sending emails** with Resend from your domain

## Prerequisites

- A Next.js project deployed on Vercel (typically via `/bootstrap`)
- Cloudflare connected to your computer (`/start` handles it)
- A domain name (bought now or already existing)

## Tips

{{callout:tip|DNS propagation = between 5 min and 24h}}
After the nameserver change, DNS can take **5 to 30 minutes** (and rarely up to 24h) to propagate everywhere in the world. Don't panic if your site isn't immediately accessible, be patient. It happens. The HTTPS certificate is set up automatically by Vercel as soon as the DNS is in place.
{{/callout}}

{{callout:warning|Don't forget your OAuth after a domain change}}
If you have already configured Google or GitHub OAuth, you must **add** the new callback URL (`https://your-domain/api/auth/callback/google` or `/github`) in the corresponding consoles. Otherwise the login crashes in production with `redirect_uri_mismatch`. Hypervibe reminds you of this at the end of the process.
{{/callout}}

{{callout:info|Email Routing = free, unlimited, no real mailbox}}
Cloudflare Email Routing lets you receive emails at `contact@mysite.com` (or `support@`, `hello@`, etc.) and redirect them to an existing mailbox (Gmail, Outlook, etc.). It's **free, unlimited**, and there's no need to create a real mailbox. You just reply from your usual mailbox.
{{/callout}}
