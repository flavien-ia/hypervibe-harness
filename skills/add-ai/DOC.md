# /add-ai

Adds **artificial intelligence** to your app: an assistant that answers your users, automatic analysis of what comes in, or content generation. The cost is worked out and approved **before** a single line of code, and the key created for your project carries a **spending cap** that no bug can cross.

## When to use it

- You want a **chat assistant** inside your app, answering your users' questions
- You want to **classify, extract or summarise** what arrives automatically (messages, documents, forms)
- You want to **generate text** from your own data (descriptions, summaries, drafts)
- You do not want to discover what AI costs on an invoice at the end of the month

## How it goes

1. **Four questions, no more.** What the AI must do, who will use it, roughly how often per day, and whether personal data will pass through. Hypervibe infers the right approach: a live assistant, automatic processing, or generation.

2. **Cost, before anything else.** Hypervibe reads the **live prices** at the provider and shows you a table: what one use costs, what that makes per month at your volume, across two tiers of models. You say yes to an amount, not to an idea. Nothing is installed before you agree.

3. **The OpenRouter account.** That is the chosen provider: one key opens hundreds of models, with no markup on the prices. The first time, Hypervibe walks you through creating the account and storing a key in the vault. After that, every future project serves itself.

4. **The project key, capped.** Hypervibe creates a key dedicated to this project, with the spending limit you approved, and installs it. The value never passes through the conversation.

5. **The install.** A single file every AI call goes through, the chosen recipe on top (a conversation page, or an analysis function), and a log that records the real cost of every call.

## What it creates for you

- A **single point of passage** to AI in your code: switching model later is changing one word
- Depending on your need: a **conversation page** that answers word by word, or an **analysis function** that returns a usable result
- A **capped key** at the provider, installed in your project and online
- A **spending log**: every call recorded with its exact cost
- An update to your **privacy policy**

## Prerequisites

- A Next.js project (typically started by `/bootstrap`)
- An OpenRouter account, free to create (Hypervibe walks you through it) and topped up with credits
- A database for the cost log (`/add-db` if you do not have one)

## Tips

{{callout:warning|The cap is your real safety net}}
AI is billed by usage: a loop gone wrong can get expensive overnight. That is why your project key carries a spending limit held by the provider itself. Past that amount, calls stop and your app says so clearly, instead of quietly billing on. You raise the cap when you decide to.
{{/callout}}

{{callout:tip|Start on the Éco tier}}
For sorting, classifying, extracting or summarising, fast models do the job for a few cents a month. The higher tier earns its price when the answer is read by a customer and carries your brand. Hypervibe shows both figures side by side: the gap is often twentyfold.
{{/callout}}

{{callout:warning|Free models and your data}}
Free models exist and are genuinely useful for prototyping. But some providers reserve the right to learn from what passes through. As soon as personal data is involved (customer messages, CVs, anything identifying someone), Hypervibe rules out the free tier and routes to providers that commit not to train on your content.
{{/callout}}

{{callout:info|Live AI or autonomous agent}}
This command installs AI that answers within seconds, inside your app. If you are after a process that runs on its own in the background, makes decisions and uses tools, that is `/add-agent`. And if the processing needs no intelligence at all, that is `/add-automation`.
{{/callout}}
