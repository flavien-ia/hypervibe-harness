# /add-dark-mode

Enables **dark mode** on your site (light / dark / system), with a ready-to-use toggle button.

## When to use it

- You want your visitors to be able to **switch to dark mode** (the eyes of night owls will thank you)
- You want your site to automatically respect visitors' system preference (macOS/Windows in dark = your site in dark)
- You want to add a light / dark / system **selector** in your header or footer

## How it goes

1. **Check**: if dark mode is already in place, Hypervibe offers you a menu (change the default mode, reinstall the button, redo the color audit, place the button in the UI, or uninstall).

2. **Project detection**: Hypervibe verifies that it really is a Next.js project with **Tailwind v4**. For Tailwind v3 projects, it explains how to migrate first.

3. **Installing next-themes**: the reference library for dark mode in Next.js is installed.

4. **Configuring the dark variant in Tailwind**: Hypervibe adds `@custom-variant dark` to your `globals.css`. From now on, you (or Hypervibe) can write `dark:bg-black dark:text-white` on any component.

5. **Audit of existing colors**: Hypervibe re-reads your `globals.css`, identifies the color tokens already defined, and proposes **dark variants** for each token (keeping the same warmth / saturation, but inverted). You validate the proposals or adjust them.

6. **Mounting the ThemeProvider**: Hypervibe adds the provider in your root layout (and in `[locale]/layout.tsx` if i18n is detected). No flash on load, the `dark` class is set on `<html>` before hydration.

7. **Creating the ThemeToggle component**: a 3-state button (☀️ light / 🌙 dark / 🖥 system), ready to drop into your UI. Style consistent with your site (primary colors, adapted size).

8. **Guided placement of the button** (optional): Hypervibe detects your header / navbar / footer and suggests **where to insert** `<ThemeToggle />` in your interface. You validate the location.

## What it creates for you

- The `next-themes` package installed
- The `@custom-variant dark` variant in `globals.css`
- **Dark color tokens** proposed in `globals.css` (you validate what you keep)
- The `ThemeProvider` component mounted in your layout
- The `ThemeToggle` component (to insert wherever you want)
- `suppressHydrationWarning` added on `<html>` (avoids the React warning on first load)

## Prerequisites

- The project must be in **Next.js + Tailwind v4** (typically initialized by `/bootstrap`). Tailwind v3 requires a migration step beforehand.

## Tips

{{callout:info|The default mode is "system"}}
When a visitor arrives with no saved preference, your site automatically adopts their OS preference (dark if it's in dark, light otherwise). This is the best UX default. You can force it to "light" or "dark" if you prefer (at the cost of imposing your aesthetic choice).
{{/callout}}

{{callout:tip|To apply dark to your components}}
On each component that needs to adapt: add the `dark:` variant to the Tailwind classes. Example:
```
<div class="bg-white text-black dark:bg-zinc-900 dark:text-white">
```
Hypervibe can do it for you: *"adapt my site to dark mode"*. It re-reads each component, proposes the dark colors, you validate.
{{/callout}}

{{callout:tip|No white flash on first load}}
Dark mode is applied from the very first render of the page, with no transient white flash. All the technical wiring for that is set up by Hypervibe, you have nothing to configure.
{{/callout}}
