# /add-pwa

Turns your site into an installable app (PWA) on phone and computer, without going through the stores. Your visitors add it to their home screen and open it in full screen, like a real application.

## When to use it

- You want your users to be able to **install your app on their home screen** (icon, full screen, no address bar)
- You want a more "native app" experience (fast launch, offline fallback page)
- You are setting the stage for **push notifications** (`/add-push-notification` requires a PWA)

## How it works

1. **Check**: if the PWA is already in place, Hypervibe offers a menu (regenerate the icons, change the name or colors, reinstall pieces).

2. **Project detection**: Hypervibe checks that it is a Next.js project and that the favicon (`icon.svg`, created by `/bootstrap`) is present, because the app icons derive from it.

3. **Serwist installation**: the library that handles the "service worker" (the invisible component that makes the app installable and gives it an offline cache).

4. **Manifest**: your app's identity card (name, colors, icons, full-screen mode), generated from your project (name and palette detected automatically).

5. **Icons**: Hypervibe rasterizes your favicon into all the sizes needed (Android, iOS, "maskable" icon with safe zone), in your theme's colors.

6. **Install invitation window**: a small window shows on mobile to invite the visitor to install the app. On Android, an "Install" button triggers the native installation; on iPhone, it explains step by step the "Share then Add to Home Screen" gesture (Apple does not offer a direct button). It shows neither on computer, nor if the app is already installed, and knows to make itself scarce for 3 days when closed.

7. **Code verification**: typing and lint before wrapping up.

## What it creates for you

- The app manifest (`src/app/manifest.ts`)
- The service worker (`src/app/sw.ts`) with a minimal offline cache
- The icons (`public/icons/`): 192, 512, maskable, apple-touch
- The `InstallPrompt` component mounted in your layout (the invitation window)
- The iOS settings (Apple icon, status bar color)

## Prerequisites

- A Next.js project (typically created by `/bootstrap`)
- Nothing else: no database or user accounts needed

## Good to know

- The service worker is **disabled in development** (so it does not pollute your cache while you code): installation and offline mode are tested **after deployment**, on the live site.
- The logical next step: `/add-push-notification` to send notifications to your users' phones.
