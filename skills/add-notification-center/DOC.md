# /add-notification-center

Adds a notification bell to your app, with an unread badge and a browsable history. The panel lists the user's notifications; clicking opens the relevant page and marks it as read.

## When to use it

- You want your users to **find their notifications inside the app** (browsable history, read/unread)
- You want the classic **bell with a counter** at the top of the interface
- With or without push notifications: the center works on its own

## The difference with /add-push-notification

- **Push** sends a **system** notification, on the phone, even when the app is closed: it grabs attention, then disappears.
- **The in-app center** keeps each notification **inside the app**: the user can consult them whenever they want, see what is new, mark them as read.

The two complement each other and can be installed **in any order**: as soon as both are present, a single call (`notifyUser`) rings the bell **and** pushes to the phone.

## How it works

1. **Check**: if the center is already in place, Hypervibe offers a menu (reinstall the bell, regenerate, re-wire the push).

2. **Prerequisites**: a database (`/add-db`) to store the notifications, and user accounts (`/add-auth`) to know who each notification belongs to.

3. **Notifications table**: title, message, link, read/unread state, date.

4. **`notifyUser` server helper**: the single entry point to notify someone from your code. It records the notification (for the bell) and, if push notifications are installed, also sends one to the phone.

5. **API**: list the notifications, count the unread ones, mark as read (one or all).

6. **The bell**: a ready-to-use component, placed in your header. Red badge with the counter, dropdown panel, instant update on every action (and a background refresh of the counter every 30 seconds).

7. **Code verification**: typing and lint before wrapping up.

## What it creates for you

- The `notification` table in the database
- The server helper `~/server/notify.ts` (`notifyUser(db, userId, { title, body, url })`)
- The `notifications` tRPC router (list, counter, read marking)
- The `NotificationBell` component mounted in your header

## Prerequisites

- A database (`/add-db`)
- User accounts (`/add-auth` in users mode)
- No need for PWA or push: the center is self-contained

## Good to know

- To create a notification from your server code: `await notifyUser(db, userId, { title: "Order shipped", body: "Your parcel arrives Thursday.", url: "/orders" })`.
- If you add `/add-push-notification` later, the wiring happens automatically: `notifyUser` will start sending the system notification too, without changing anything in your code.
