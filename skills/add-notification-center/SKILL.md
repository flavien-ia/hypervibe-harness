---
name: add-notification-center
description: "Adds an in-app notification center to a Next.js app: a bell in the navigation bar, with a badge showing the number of unread notifications, a dropdown panel that lists the notifications, and read/unread state. Creates the `notification` table, the `notifyUser` server helper, the tRPC router, and the bell component. Independent of /add-push-notification (no required order): if push is present, the `notifyUser` helper also sends a system notification. Depends on /add-db and /add-auth (users mode)."
argument-hint: ""
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# Add Notification Center: in-app bell (badge + list)

You add an **in-app notification center**: a bell with a badge showing the number of unread notifications, a panel that lists the notifications, and read/unread marking. This is different from system push: here the notifications **live inside the app** and remain available to consult.

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

---

## Step 0: Re-run? (idempotence)

Marker `hypervibe:notification-center` at the top of `<WEB_DIR>/src/server/notify.ts`.

```bash
test -f "<WEB_DIR>/src/server/notify.ts" && grep -q "hypervibe:notification-center" "<WEB_DIR>/src/server/notify.ts" && echo present || echo absent
```

- **present** → menu: (1) reinstall the bell, (2) regenerate the router, (3) re-wire the push if `/add-push-notification` has been added since. Handle it, then jump to the summary.
- **absent** → Step 1.

Templates/scripts path: `${CLAUDE_SKILL_DIR}/../../templates/notif-center/`.

---

## Step 1: Prerequisites

1. **Detect project root**: invoke `_detect-project-root` → `WEB_DIR`, `IS_MONOREPO`, `IS_NEXTJS`. Abort if not Next.js.
2. **Database**: invoke `_check-deps db`. If `db_ok = false`, suggest `/add-db`, then re-check.
3. **Auth in users mode**: read `<WEB_DIR>/src/server/auth.ts`, look for the `// hypervibe:auth-modes` marker. If it does not contain `users`, suggest `/add-auth` (users mode): notifications are attached to a logged-in user.

(No dependency on `/add-pwa` or `/add-push-notification`: the in-app center is self-contained.)

---

## Step 2: Notifications table

1. Insert `templates/notif-center/schema-snippet.ts` into the Drizzle schema (`<WEB_DIR>/src/server/db/schema.ts`, or `packages/db/src/schema.ts` in a monorepo), after the `users` table. Check the imports (`boolean`, `index`, `text`, `timestamp`, `sql`, `createTable`, `users`).
2. `cd "<WEB_DIR>" && pnpm db:push`.

---

## Step 3: `notifyUser` server helper (+ push wiring if present)

1. Copy `templates/notif-center/notify.ts` to `<WEB_DIR>/src/server/notify.ts` (keep the `// hypervibe:notification-center` marker at the top and `// hypervibe:notify-push` inside the function).
2. **Push wiring (any order)**: check whether push is already installed:
   ```bash
   test -f "<WEB_DIR>/src/server/push.ts" && grep -q "hypervibe:push" "<WEB_DIR>/src/server/push.ts" && echo push-present || echo push-absent
   ```
   - **push-present** → follow `templates/notif-center/notify-push-block.ts`: add the `sendPushToUser` import at the top of `notify.ts` and replace the marker line `// hypervibe:notify-push` with `await sendPushToUser(db, userId, payload);`. (Idempotent: do not re-inject if it is already there.) That way a notification rings the bell **and** pushes to the phone.
   - **push-absent** → inject nothing (the marker stays, ready for when `/add-push-notification` is run: that skill is the one that will do the injection).

---

## Step 4: tRPC router

1. Copy `templates/notif-center/notifications-router.ts` to `<WEB_DIR>/src/server/api/routers/notifications.ts`.
2. Wire it into `appRouter` (`<WEB_DIR>/src/server/api/root.ts`):
   ```ts
   import { notificationsRouter } from "~/server/api/routers/notifications";
   // inside createTRPCRouter({ ... }):
   notifications: notificationsRouter,
   ```

---

## Step 5: The bell (UI)

1. Copy `templates/notif-center/notification-bell.tsx` to `<WEB_DIR>/src/components/`. Adapt the colors (the badge is `bg-red-500` by default; tokens `border-border`/`bg-background`/`text-muted-foreground` to adjust to the palette if needed).
2. Mount `<NotificationBell />` in the **header / navigation bar** of the logged-in areas. Locate the header component (`src/components/layout/header.tsx`, `navbar.tsx`, or similar) and place it near the user actions (avatar, menu). If the placement is not obvious, ask the user where they want the bell.

---

## Step 6: CLAUDE.md + verification

1. Invoke `_update-claude-md`:
   - `stack`: `- **Notification center**: \`notification\` table, in-app bell (unread badge + list), \`notifyUser\` helper.`
   - `conventions`: `- Notify a user: \`notifyUser(db, userId, { title, body, url })\` from \`~/server/notify\` (persists for the bell, and sends a push if \`/add-push-notification\` is installed).`
2. `cd "<WEB_DIR>" && pnpm tsc --noEmit && pnpm lint`.

---

## Step 7: Summary + cross-suggestion

Summarize:
- A **bell** is in place with the unread counter and the list of notifications.
- To create a notification from the server: `await notifyUser(db, userId, { title, body, url })`.

**Suggest push (if absent)**: check `test -f "<WEB_DIR>/src/server/push.ts"`. If absent, suggest via `AskUserQuestion`:

> You now have the bell **inside the app**. You can also add **system notifications** (push): they arrive on the user's phone **even when the app is closed**, and appear in the OS notification center.
>
> The difference: the bell is available inside your app (history, read/unread); push grabs attention outside the app. The two complement each other, and `notifyUser` will automatically send both.

- **Yes** → run `/add-push-notification` (which will detect the center and wire the push sending into `notifyUser`).
- **No** → "No problem, the bell works on its own. You can add push later with `/add-push-notification`."
