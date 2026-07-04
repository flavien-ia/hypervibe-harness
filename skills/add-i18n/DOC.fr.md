# /add-i18n

Rend votre site multilingue en proposant plusieurs langues à vos visiteurs. Français, anglais, espagnol, etc. : chaque page est traduite et le visiteur choisit la sienne.

## Quand l'utiliser

- Votre cible inclut **plusieurs pays / plusieurs langues**
- Vous voulez ajouter l'anglais (ou une autre langue) à un site français existant
- Vous voulez gérer le SEO multilingue proprement (URLs `/fr/...`, `/en/...`, hreflang, sitemap par langue)

## Comment ça se passe

1. **Vérification** : si i18n est déjà en place, Hypervibe vous propose un menu : ajouter une nouvelle langue, changer la langue par défaut, supprimer une langue, etc.

2. **Choix des langues** : Hypervibe vous demande quelles langues vous voulez supporter (ex: `fr en es`) et laquelle sera la langue **par défaut**.

3. **Installation de next-intl** : la bibliothèque de référence pour l'i18n en Next.js est installée.

4. **Scaffolding** (en un coup, via un script déterministe) :
  - Création des fichiers `messages/<langue>.json` pour chaque langue (FR/EN/ES/DE/IT/PT ont des templates pré-traduits ; les autres partent vides en anglais)
  - Configuration du routing (`src/i18n/routing.ts`) avec la liste des langues + langue par défaut
  - Loader des messages (`src/i18n/request.ts`)
  - Layout `[locale]` minimal, plus un helper pour que chaque page déclare sa propre URL canonique et ses variantes de langue (**hreflang SEO**, les signaux dont Google a besoin pour indexer correctement chaque langue)
  - Composant `LanguageSwitcher` prêt à dropper dans votre nav
  - Le pattern 404 complet : un catch-all pour que les URLs inconnues affichent votre page 404 personnalisée (dans la langue du visiteur) au lieu de la 404 par défaut de Next.js

5. **Middleware** : un middleware Next.js est créé (ou fusionné si vous en avez déjà un) pour gérer les URLs `/fr/...`, `/en/...`, etc.

6. **Restructuration** : vos pages existantes sont déplacées de `src/app/` vers `src/app/[locale]/` (toutes sauf `api/` qui reste à la racine). Les providers (TRPCReactProvider, fonts, etc.) sont remontés dans le bon layout.

7. **Mise à jour du sitemap** : si vous en avez un, il est étendu avec une entrée par langue × page (toujours pour le SEO).

## Ce que ça crée pour vous

- Le package `next-intl` installé
- Le dossier `messages/` avec un fichier `.json` par langue (à enrichir au fur et à mesure)
- La structure `src/app/[locale]/` avec vos pages
- Un composant `LanguageSwitcher` (à placer dans votre header / footer où vous voulez)
- Un middleware pour la redirection automatique selon la langue préférée du visiteur
- Le SEO multilingue (hreflang, sitemap par langue)

## Prérequis

- Le projet doit être en Next.js avec App Router (typiquement initialisé par `/bootstrap`)
- Aucune autre dépendance, i18n peut être ajouté avant ou après les autres briques

## Astuces

{{callout:tip|Pour traduire vos textes}}
Dans vos composants serveur : `const t = await getTranslations("namespace")`. Dans vos composants client : `const t = useTranslations("namespace")`. Puis : `t("clé")` retourne la traduction adaptée à la langue actuelle. Les textes vivent dans `messages/<langue>.json`.
{{/callout}}

{{callout:info|Demandez à Hypervibe de traduire pour vous}}
Pour ajouter une langue à un site déjà rempli en français, vous pouvez simplement dire à Hypervibe : *"traduis tout le site en anglais"*. Elle relit chaque fichier `messages/fr.json` et génère le `messages/en.json` correspondant. Vous relisez derrière pour ajuster la finesse de ton.
{{/callout}}

{{callout:info|Votre SEO sur la langue par défaut est préservé}}
Grâce à `localePrefix: "as-needed"`, les URLs de votre langue par défaut restent exactement les mêmes (`/mon-article`, sans préfixe) : votre SEO existant, vos backlinks et vos données Search Console sont conservés intacts. Seules les langues supplémentaires reçoivent un préfixe (`/en/my-article`). Rien à rediriger.
{{/callout}}
