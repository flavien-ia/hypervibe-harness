# /add-push-notification

Adds push notifications: your app can alert its users on their phone, even when closed. This is the "system" notification, the one that shows up in the device's notification center, sent from your server.

## When to use it

- You want to **alert your users** about an event (appointment reminder, new message, order shipped) without them having the app open
- You want to **bring users back** into your app at the right moment
- You already have (or are willing to install) a PWA: that is the technical prerequisite

## How it works

1. **PWA check (essential prerequisite)**: push notifications rely on the PWA's "service worker", the component that receives and displays notifications even with the app closed. **Without a PWA, push is technically impossible.** If your app is not one, Hypervibe explains this and offers to turn it into a PWA right away (`/add-pwa`), then continues.

2. **Other prerequisites**: a database (`/add-db`) to remember which devices are subscribed, and user accounts (`/add-auth`) to know who each device belongs to.

3. **Signing keys (VAPID)**: Hypervibe generates the key pair that proves your server is the one sending the notifications, and stores it in your environment variables (local + Vercel).

4. **Subscriptions table**: each device that accepts notifications is recorded in the database, tied to its user.

5. **Service worker extension**: receiving the notification, displaying it, and opening the right page of the app on click.

6. **Server side**: a `sendPushToUser(db, userId, { title, body, url })` helper to call from anywhere in your code to notify someone (all their subscribed devices, with automatic cleanup of expired subscriptions).

7. **User side**: an "Enable notifications" button (placed in the logged-in area) that requests permission and subscribes the device.

## What it creates for you

- The VAPID keys in your environment variables
- The `push_subscription` table in the database
- The push handlers in the service worker
- The server helper `~/server/push.ts` (`sendPushToUser`)
- The `push` tRPC router (subscribe, unsubscribe, status)
- The `EnableNotifications` component (the enable button)

## Prerequisites

- **A PWA** (`/add-pwa`): offered automatically if absent
- A database (`/add-db`)
- User accounts (`/add-auth` in users mode)

## Good to know

- **iPhone/iPad**: web push only works if the user has **installed the app on their home screen** (iOS 16.4 minimum), and the activation must come from a gesture on their part (the button). This is an Apple rule, not a limitation of your app.
- Push is tested **after deployment** (the service worker is disabled in development).
- Natural complement: `/add-notification-center` adds a bell **inside the app** with the notification history. The two combine: a single call then notifies both the bell **and** the phone.
