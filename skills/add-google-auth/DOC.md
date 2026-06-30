# /add-google-auth

Enables **Google login** on your app. Your users can sign in with a single click on "Continue with Google".

## When to use it

- You have already set up basic authentication (`/add-auth` in user mode) and you want to offer your visitors a faster login
- You want to reduce signup friction (a visitor logged into their Google account can create an account on your site in 1 click)

## How it works

1. **Check**: Hypervibe verifies that NextAuth in user mode is already in place. If not, it redirects you to `/add-auth`, no worries, you will come back here afterwards.

2. **Creating a Google Cloud project**: Hypervibe guides you step by step through the Google Cloud console (console.cloud.google.com). You create a new project (or select an existing one). It's quick.

3. **OAuth consent screen**: you fill in your app's information (name, contact email, `email` and `profile` scopes). Hypervibe gives you the exact click to make at each step.

4. **Creating the OAuth credentials**: you create an "OAuth 2.0 Client" of type Web Application, with the callback URLs (local + production) that Hypervibe already provides ready-made for you.

5. **Retrieving the keys**: Google shows you a **Client ID** and a **Client Secret**. You copy-paste them into the chat.

6. **Automatic configuration**: Hypervibe pushes the two keys into the local `.env` + Vercel (production + preview + development), adds the Google provider in `src/server/auth.ts`, and updates `CLAUDE.md`.

7. **Final check**: Hypervibe reminds you to test locally (`pnpm dev` then `/api/auth/signin`) and explains Google's "test mode" status.

## What it creates for you

- A **Google Cloud project** in your name, with a consent screen and an OAuth client
- The `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` variables in the local `.env` + Vercel
- The Google provider added to your `src/server/auth.ts`
- An update to `CLAUDE.md` (in particular: an important reminder that if you change domain later, you will need to add the new URL on Google's side)

## Prerequisites

- `/add-auth` must have been run in **user mode** (admin mode is not compatible with OAuth, it is designed for a single person, not for a signup system).
- A Google account (free). You probably already have one if you have a Gmail.

## Tips

{{callout:tip|Configure your domain BEFORE, ideally}}
If you plan to use a custom domain (`mysite.com` instead of `mysite.vercel.app`), run `/add-domain` **before** `/add-google-auth`. Otherwise the OAuth URLs will point to the Vercel URL, and you will have to come back to the Google Cloud Console later to **add** (and not replace, we also keep the Vercel URL as a test fallback) the URLs of your real domain.
{{/callout}}

{{callout:info|Test mode = max 100 users}}
By default, your Google app is in "test mode": only the test users added at step 8 can log in. That's perfect for development. To open access to everyone, go to the Google Cloud console -> APIs and services -> Consent screen -> "Publish app". With the `email` and `profile` scopes only, it's immediate (no Google verification required).
{{/callout}}
