# {{PROJECT_NAME}}

{{DESCRIPTION}}

## Stack
- **Framework**: Next.js 15 (App Router) - T3 Stack
- **Langage**: TypeScript
- **Styling**: Tailwind CSS v4 + shadcn/ui (composants dans `src/components/ui/`)
- **Fonts**: Geist Sans (via `next/font/google` dans `src/app/layout.tsx`)
- **API**: tRPC v11
- **ORM**: Drizzle
- **Déploiement**: Vercel

## Project structure
```
src/
├── app/             ← App Router (pages, layouts)
├── server/
│   ├── api/         ← tRPC routers (root.ts + routers/*.ts)
│   └── db/          ← Drizzle schema + connection
├── components/ui/   ← shadcn/ui + LinkButton
├── styles/          ← globals.css (Tailwind + CSS vars + Geist wiring)
└── trpc/            ← tRPC client setup
```

## Key Commands
- `pnpm dev` - dev server (port 3000). **Ne pas lancer `pnpm db:studio`** - outil de debug avancé, pas nécessaire en usage normal.
- `pnpm lint` - ESLint
- `pnpm tsc --noEmit` - type-check sans émettre

## Conventions
- **Design** : toujours lire `src/styles/globals.css` avant de créer un composant - les CSS variables de palette, fonts et espacements y sont définies. Ne jamais utiliser de couleurs Tailwind par défaut. Police par défaut : Geist Sans.
- **UI** : toujours utiliser les composants shadcn/ui de `~/components/ui/` avant de créer des composants custom. Installer de nouveaux composants avec `npx shadcn@latest add <name>` (toujours `npx`, jamais `pnpm dlx` - ce dernier échoue avec ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND).
- **Boutons-liens** : utiliser `<LinkButton href="..." variant="...">` depuis `~/components/ui/link-button`. JAMAIS `<Button asChild><Link>...</Link></Button>` - shadcn v4 n'expose pas `asChild` et ça casse le build.
- **Police Geist** : Geist (via `next/font/google`) est wirée dans `<html className={geist.variable}>` (`src/app/layout.tsx`) + rule `--font-sans` dans `globals.css`. Ne JAMAIS retirer ces éléments en modifiant `layout.tsx` ou `globals.css` - sans ça, l'app tombe sur Times New Roman. Pour changer la police, remplacer Geist explicitement par une autre Google Font via `next/font` en préservant la structure (import → instance → variable sur html → rule CSS).
- **Images** : toujours utiliser le composant `<Image>` de `next/image` au lieu de `<img>`. Toujours inclure un attribut `alt` descriptif.
- **Feedback** : utiliser les composants `toast` / `sonner` de shadcn/ui pour les messages de succès, erreur, et information. Ne jamais utiliser `alert()` ou `window.confirm()`.
- **Formulaires** : toute route tRPC publique qui accepte des données utilisateur (formulaire de contact, inscription, etc.) doit utiliser `rateLimitedProcedure` au lieu de `publicProcedure`.
- **API** : toute communication client-serveur passe par tRPC (routeurs dans `src/server/api/routers/`, enregistrés dans `root.ts`). Ne jamais créer de route API Next.js (`src/app/api/`) sauf pour les webhooks de services externes (Stripe, OAuth callbacks).
- **Server vs client tRPC** : server components → `import { api } from "~/trpc/server"` puis `await api.router.procedure()`. Client components → `import { api } from "~/trpc/react"` puis hooks `api.router.procedure.useQuery()`.

## Deploy
`git push` déclenche le déploiement automatique sur Vercel. Ne jamais utiliser `vercel --prod` directement.

## Pousser des variables d'environnement
Pour tout ajout/modification d'env var (local `.env` + Vercel), invoquer la skill interne `_push-env-vars`. Elle gère le `.env` local ET Vercel (production / preview / development) en une seule opération, de façon idempotente, et évite le piège `echo` (qui ajoute un `\n` invisible).
Ne JAMAIS invoquer `vercel env add` directement.
Vérifier en fin de chaîne : `vercel env pull .env.check --environment=production --yes` puis inspecter, puis `rm .env.check`.

## Variables d'environnement
- `DATABASE_URL` - placeholder pour l'instant. Remplacé par la vraie URL Neon quand `/add-db` est invoqué.
- `NEXT_PUBLIC_APP_URL` - URL publique du site (https://{{PROJECT_NAME}}.vercel.app en prod/preview, http://localhost:3000 en dev).
