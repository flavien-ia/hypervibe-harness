# /add-dark-mode

Active le **mode sombre** sur votre site (clair / sombre / système), avec un bouton de bascule prêt à l'emploi.

## Quand l'utiliser

- Vous voulez que vos visiteurs puissent **basculer en mode sombre** (les yeux des nocturnes vous remercieront)
- Vous voulez que votre site respecte automatiquement la préférence système des visiteurs (macOS/Windows en sombre = votre site en sombre)
- Vous voulez ajouter un **sélecteur** clair / sombre / système dans votre header ou footer

## Comment ça se passe

1. **Vérification** : si le dark mode est déjà en place, Hypervibe vous propose un menu (changer le mode par défaut, réinstaller le bouton, refaire l'audit des couleurs, placer le bouton dans l'UI, ou désinstaller).

2. **Détection du projet** : Hypervibe vérifie que c'est bien un projet Next.js avec **Tailwind v4**. Pour les projets Tailwind v3, elle vous explique comment migrer d'abord.

3. **Installation de next-themes** : la bibliothèque de référence pour le dark mode en Next.js est installée.

4. **Configuration de la variante dark dans Tailwind** : Hypervibe ajoute `@custom-variant dark` dans votre `globals.css`. À partir de maintenant, vous (ou Hypervibe) pouvez écrire `dark:bg-black dark:text-white` sur n'importe quel composant.

5. **Audit des couleurs existantes** : Hypervibe relit votre `globals.css`, identifie les tokens couleurs déjà définis, et vous propose **des variantes dark** pour chaque token (en gardant la même chaleur / saturation, mais inversée). Vous validez les propositions ou ajustez.

6. **Montage du ThemeProvider** : Hypervibe ajoute le provider dans votre layout racine (et dans `[locale]/layout.tsx` si i18n est détecté). Pas de flash au chargement, la classe `dark` est posée sur `<html>` avant l'hydratation.

7. **Création du composant ThemeToggle** : un bouton 3 états (☀️ clair / 🌙 sombre / 🖥 système), prêt à dropper dans votre UI. Style cohérent avec votre site (couleurs primaires, taille adaptée).

8. **Placement guidé du bouton** (optionnel) : Hypervibe détecte votre header / navbar / footer et vous propose **où insérer** `<ThemeToggle />` dans votre interface. Vous validez l'emplacement.

## Ce que ça crée pour vous

- Le package `next-themes` installé
- La variante `@custom-variant dark` dans `globals.css`
- Des **tokens couleurs dark** proposés dans `globals.css` (vous validez ce que vous gardez)
- Le composant `ThemeProvider` monté dans votre layout
- Le composant `ThemeToggle` (à insérer où vous voulez)
- `suppressHydrationWarning` ajouté sur `<html>` (évite l'avertissement React au premier chargement)

## Prérequis

- Le projet doit être en **Next.js + Tailwind v4** (typiquement initialisé par `/bootstrap`). Tailwind v3 demande une étape de migration en amont.

## Astuces

{{callout:info|Le mode par défaut est "système"}}
Quand un visiteur arrive sans préférence enregistrée, votre site adopte automatiquement la préférence de son OS (sombre s'il est en sombre, clair sinon). C'est le meilleur défaut UX. Vous pouvez le forcer en "clair" ou "sombre" si vous préférez (au prix d'imposer votre choix esthétique).
{{/callout}}

{{callout:tip|Pour appliquer le dark à vos composants}}
Sur chaque composant qui doit s'adapter : ajoutez la variante `dark:` aux classes Tailwind. Exemple :
```
<div class="bg-white text-black dark:bg-zinc-900 dark:text-white">
```
Hypervibe peut le faire pour vous : *"adapte mon site au mode sombre"*. Elle relit chaque composant, propose les couleurs dark, vous validez.
{{/callout}}

{{callout:tip|Pas de flash blanc au premier chargement}}
Le mode sombre est appliqué dès le tout premier rendu de la page, sans flash blanc transitoire. Tout le câblage technique pour ça est posé par Hypervibe, vous n'avez rien à configurer.
{{/callout}}
