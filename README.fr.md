# Hypervibe

> 🇬🇧 [Read in English](README.md)

Un plugin Claude Code qui crée des projets web complets (stack T3) avec des addons modulaires. Conçu pour les non-techs qui veulent créer et déployer des apps web en décrivant ce qu'ils veulent en français.

> 📘 **Première fois ? Suivez le [guide d'installation pas à pas](https://hypervibe.fr/plugin/installation).** Il couvre les prérequis, les comptes à créer et votre premier projet, de bout en bout.

## Installation

Il vous faut d'abord [Claude Code](https://claude.com/claude-code). Il est inclus dès l'abonnement **Claude Pro** (ou supérieur ; la version gratuite ne suffit pas), et est livré avec l'application Claude pour Mac et Windows, ou en ligne de commande. Pas encore de compte ? [Créez-le et prenez votre abonnement ici](https://claude.ai/referral/BtZlSHizAA). Ensuite, dans Claude Code, lancez :

```
/plugin marketplace add flavien-ia/hypervibe-harness
/plugin install hypervibe@hypervibe-harness
```

Vous mettez à jour depuis une version antérieure à la 2.5 ? Après avoir mis à jour le plugin, relancez simplement `/start` dans Claude Code : il détecte vos anciens mécanismes de tâches de fond et les regroupe pour vous dans le nouveau mécanisme unifié, en toute sécurité et avec votre accord à chaque étape (sans effet si vous n’avez rien à migrer). Plus de contexte dans [MIGRATION.md](MIGRATION.md).

Puis tapez `/start` : il installe tout le reste pour vous (Node.js, pnpm, Git, et les outils de chaque service) et vérifie que vos connexions fonctionnent.

Vous préférez une version guidée, étape par étape ? Suivez le guide complet sur **[hypervibe.fr/plugin/installation](https://hypervibe.fr/plugin/installation)**.

## Par où commencer

| Première fois ? | Déjà à l'aise ? |
|---|---|
| `/start` - vérifie votre config et présente le plugin | `/bootstrap` - lancez-vous directement |
| `/prof` - explique comment tout fonctionne | `/spec` - construisez un cahier des charges d'abord |

## Comment ça marche

Décrivez simplement ce que vous voulez construire. Claude analyse votre description et déduit les addons nécessaires (base de données, auth, paiements, etc.), puis vous présente le plan pour validation avant de construire.

```
/bootstrap Mon site vitrine de photographe
/bootstrap Mon app de gestion de leads avec comptes utilisateurs
/bootstrap Mon SaaS de facturation en ligne avec paiements Stripe
```

### Trois façons de définir votre projet

Quand vous lancez `/bootstrap`, vous choisissez comment décrire votre app :

- **A - Construire un cahier des charges ensemble** (`/spec`) : Claude vous guide étape par étape à travers 5 blocs (projet, pages, design, fonctionnalités, contraintes) et produit un `cahier-des-charges.md`
- **B - Fournir un cahier des charges existant** : donnez à Claude un fichier `.md`, il le lit et en déduit l'infrastructure
- **C - Description courte uniquement** : Claude pose les questions d'infrastructure en une fois et construit une app simple

## Toutes les skills

### Skills de workflow

| Skill | Ce que ça fait |
|---|---|
| `/bootstrap` | Créer un nouveau projet de zéro |
| `/spec` | Construire un cahier des charges détaillé, étape par étape |
| `/start` | Premier lancement : vérifie les prérequis, présente toutes les commandes |
| `/prof` | Explique comment tout fonctionne simplement (mode pédagogique) |
| `/seo` | Audit SEO et corrections (métadonnées, sitemap, OG, structure, URLs/slugs, accessibilité, lisibilité, profondeur sémantique, fraîcheur du contenu) |
| `/geo` | Audit et optimisation pour les moteurs IA (ChatGPT, Claude, Perplexity, Google AI Overviews) - llms.txt, politique crawlers IA, schema FAQPage, signaux de citabilité, E-E-A-T, format Q&A. Complémentaire à `/seo`. |
| `/gsc` | Connecte le site à Google Search Console, vérifie le DNS automatiquement, soumet le sitemap, puis audite ce que Google voit vraiment - couverture d'indexation, top requêtes, opportunités (positions 11-20), CTR à améliorer, pages zombies. Complémentaire à `/seo` (données Google externes). |
| `/security` | Audit de sécurité (secrets, auth, headers, dépendances, RGPD) |
| `/rgpd-audit` | Audit de conformité RGPD - détecte les services tiers utilisés, met à jour le registre des sous-traitants, génère ou rafraîchit la page de politique de confidentialité |
| `/clean` | Trouve les fichiers inutilisés, le code mort, les env vars et tables DB orphelines - revue + suppression sur une branche |
| `/rotate-secret` | Renouvelle une clé secrète (Stripe, Brevo, Google…) partout où elle vit - local + Vercel |
| `/quotas` | Affiche votre consommation actuelle face aux plafonds gratuits de chaque service (Neon, Cloudflare, Brevo, Resend, Vercel) avec verdicts par jauge |

### Skills addon

Chaque addon peut être activé pendant `/bootstrap` ou utilisé seul sur un projet existant.

| Skill | Ce que ça ajoute |
|---|---|
| `/add-db` | Neon PostgreSQL + Drizzle ORM (DB provisionnée à Frankfurt, `aws-eu-central-1`) |
| `/add-auth` | NextAuth v5 - interface admin uniquement OU comptes utilisateurs (email+mot de passe avec inscription, page compte, suppression, et mot de passe oublié si email configuré). Google/GitHub OAuth proposés en add-ons optionnels en mode utilisateurs. |
| `/add-google-auth` | Active la connexion via Google OAuth (se greffe sur `/add-auth`) |
| `/add-github-auth` | Active la connexion via GitHub OAuth (se greffe sur `/add-auth`) |
| `/add-email` | Resend ou Brevo pour les emails transactionnels (auto-détecté) |
| `/add-stripe` | Stripe Checkout pour les paiements |
| `/add-i18n` | Internationalisation avec next-intl |
| `/add-storage` | Stockage de fichiers avec Cloudflare R2 |
| `/add-analytics` | Google Analytics (GA4) avec bannière cookies RGPD |
| `/add-map` | Carte interactive vectorielle (MapLibre + OpenFreeMap, gratuit sans clé API, EU). Single pin, multi-pin, itinéraire ou map-first |
| `/add-dark-mode` | Mode sombre (clair / sombre / système) avec sélecteur prêt à l'emploi |
| `/add-domain` | Connecter un nom de domaine personnalisé (guidé) |
| `/new-email-address` | Crée une adresse de réception (`contact@monsite.fr`) redirigée vers votre boîte mail (Cloudflare Email Routing) |
| `/add-cron` | Tâche planifiée - Cloudflare Worker (précis) ou GitHub Action (best-effort), choisi selon ce que fait la tâche |
| `/add-automation` | Traitement en arrière-plan - route vers cron, Cloudflare Worker, ou Render Background Worker selon le besoin. Bascule sur `/add-agent` si vous décrivez un agent IA. |
| `/add-agent` | Agent IA autonome (Anthropic Claude + tools + mémoire sémantique optionnelle + circuit breaker budgétaire + persistance complète) déployé sur Render |
| `/add-agent-dashboard` | Dashboard de monitoring des agents dans `/admin/agents` (coût, exécutions, détail tour par tour, lancer à la demande) |
| `/add-collab` | Ajouter des collaborateurs GitHub qui peuvent déployer (via GitHub Actions, sans payer de siège Vercel) |
| `/add-backup-db` | Sauvegardes automatiques de la DB Neon (Cloudflare Worker partagé, snapshots rolling + aging) |

Pour utiliser un addon seul, demandez simplement à Claude Code :
> "Ajoute l'authentification à mon projet" → utilise add-auth
> "Configure Stripe pour les paiements" → utilise add-stripe
> "Je veux connecter mon nom de domaine" → utilise add-domain

### Helpers internes

Le plugin embarque aussi des skills internes préfixées `_`, invoquées automatiquement par les skills publiques ci-dessus (jamais par l'utilisateur directement). Elles gèrent les préoccupations partagées : push des env vars (`_push-env-vars`), détection de dépendances (`_check-deps`), génération de secrets, hash de mots de passe, sous-branches de setup auth, installation automatique des CLIs, etc. Tu n'as jamais besoin de les invoquer toi-même.

## Stack technique

Les projets créés avec ce plugin utilisent :

- **Next.js** (App Router) avec TypeScript
- **tRPC** pour les routes API typées
- **Drizzle ORM** pour l'accès à la base de données
- **Tailwind CSS** pour le style
- **shadcn/ui** pour les composants UI
- **Inter** comme police par défaut (via next/font)
- **GitHub** pour le contrôle de version
- **Vercel** pour l'hébergement et le déploiement (fonctions configurées en région `fra1` - Frankfurt)
- **Neon** pour la base de données PostgreSQL (provisionnée à Frankfurt, `aws-eu-central-1` - quand l'addon DB est activé)
- **Resend ou Brevo** pour les emails transactionnels (quand l'addon email est activé)
- **Stripe** pour les paiements (quand l'addon stripe est activé)
- **Cloudflare R2** pour le stockage de fichiers (quand l'addon storage est activé)
- **Google Analytics** pour le suivi du trafic (quand l'addon analytics est activé)
- **next-intl** pour l'internationalisation (quand l'addon i18n est activé)
- **Anthropic** (API Claude) pour les agents IA autonomes (quand l'addon agent est activé)
- **Render** pour héberger les agents IA et automatisations longues (quand l'addon agent / automation route vers Render)
- **Bitwarden** comme **coffre-fort de clés** - vos clés d'accès transverses (Cloudflare, Neon, email…) sont rangées **chiffrées** dans un coffre-fort, jamais en clair sur le disque ni en variable d'environnement. `/start` le met en place (compte gratuit, région EU) ; vous tapez un mot de passe maître une fois par jour et Claude récupère les clés tout seul quand il en a besoin.

## Ce que le bootstrap configure automatiquement

Chaque projet reçoit, quel que soit le mode :

- Scaffold T3 (Next.js + TypeScript + Tailwind + tRPC)
- Bibliothèque de composants shadcn/ui
- SEO de base (métadonnées, robots.txt, sitemap.ts, placeholder OG, HTML sémantique)
- Repo GitHub privé
- Déploiement Vercel **avec fonctions en région `fra1` (Frankfurt)** - meilleure latence pour les visiteurs européens, données qui restent en UE
- Page 404 personnalisée
- Mentions légales + **page de politique de confidentialité data-driven** : alimentée par un registre central des sous-traitants (`src/lib/subprocessors.json`) qui se met à jour automatiquement à chaque ajout de service via les skills `/add-*`
- CLAUDE.md avec toutes les conventions du projet

## Conventions (inscrites dans le CLAUDE.md)

Le CLAUDE.md généré contient ces conventions que Claude Code suit à chaque interaction :

- **Design** : lire `globals.css` avant de créer un composant, utiliser les CSS variables, jamais les couleurs Tailwind par défaut
- **Police** : Inter par défaut (sauf indication contraire)
- **UX** : `cursor-pointer` sur tous les éléments cliquables
- **Feedback** : utiliser `toast`/`sonner` de shadcn/ui, jamais `alert()`
- **Images** : toujours `<Image>` de next/image avec un `alt` descriptif
- **Responsive** : mobile-first, tous les composants doivent fonctionner sur mobile (< 640px) et desktop
- **Optimistic UI** (si DB) : l'interface se met à jour immédiatement, la DB synchronise en arrière-plan
- **Git** : ne jamais pousser sans demande explicite
- **Workflow** : pour les tâches complexes (3+ fichiers), créer une todo list numérotée avec ✅/⏳
- **Composants** : toujours utiliser shadcn/ui avant de créer des composants custom
- **TypeScript** : jamais de `any`, tout typer correctement
- **Typographie** : jamais de tiret cadratin ( - ) dans les textes affichés

## Serveur MCP inclus

Le plugin inclut [Context7](https://github.com/upstash/context7-mcp), qui donne à Claude Code accès à la documentation à jour de Next.js, Tailwind, Drizzle et des autres technologies.

## Auteur

**Flavien Chervet** - [flavienchervet.fr](https://flavienchervet.fr)

## Licence

Sous [licence Apache 2.0](LICENSE). Le code source est libre d'utilisation, de modification et de redistribution selon les termes de cette licence.

### Marque

**Hypervibe** et **Certifié Hypervibe** sont des marques de Hyper Wisdom. La licence open source couvre le code, pas le nom : elle ne confère aucun droit d'usage de ces marques (cf. section 6 de la licence Apache). Vous ne pouvez pas nommer un fork, un dérivé, un produit ou un service "Hypervibe", ni laisser entendre une affiliation ou une certification officielle, sans autorisation écrite.
