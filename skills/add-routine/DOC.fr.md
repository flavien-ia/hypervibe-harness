# /add-routine

Crée une mission récurrente pour votre propre Claude : un brief chaque matin, une analyse chaque vendredi, une veille qui vous alerte. Aucun code, aucune infrastructure : c'est **votre** assistant qui travaille pour **vous**, au rythme que vous choisissez.

## Quand l'utiliser

- Un **brief du matin** : « chaque jour à 8h, lis X et envoie-moi 5 lignes »
- Une **analyse hebdomadaire** : « chaque vendredi, regarde mes stats et propose-moi des améliorations »
- Une **veille** : « surveille ce sujet et alerte-moi quand il se passe quelque chose »
- Un **tri périodique** : « chaque lundi, fais le point sur Y et prépare-moi une synthèse »

Le critère : le résultat est **pour vous** (ou votre équipe), pas pour votre app ni ses utilisateurs.

## Comment ça se passe

1. **Vous décrivez la mission et le rythme.** Si votre phrase contient déjà tout (« briefe-moi chaque matin sur mes concurrents »), Hypervibe ne repose aucune question.

2. **Le garde-fou** : si ce que vous décrivez sert en réalité votre app (nettoyer la base, écrire à vos clients...), Hypervibe vous arrête honnêtement et vous réoriente : une app ne doit jamais dépendre de votre compte Claude personnel.

3. **Les deux vérités dites franchement** : la routine tourne sur **votre compte Claude** (chaque exécution consomme un peu de votre abonnement, et s'arrête si l'abonnement s'arrête) ; selon votre installation, elle tourne dans le cloud (même ordinateur éteint) ou sur cet ordinateur quand l'app Claude est ouverte.

4. **La mission est rédigée avec vous** : objectif, étapes, ressources, livrable, limites. C'est LE contrat de la routine, vous la validez avant toute création.

5. **Création et vérification** : la routine est créée, vérifiée, et Hypervibe vous donne l'heure de sa prochaine exécution.

## Ce que ça crée pour vous

- Une **routine sur votre compte Claude** (cloud ou locale), avec sa mission validée par vous
- **Rien dans votre projet** : pas de code, pas de table, pas de déploiement
- Si la mission concerne un de vos projets Hypervibe : une note dans son `CLAUDE.md`

## Prérequis

- Votre abonnement Claude, rien d'autre
- Routines cloud : Claude Code récent ou l'app de bureau ; tâches locales : l'app de bureau

## Astuces

{{callout:tip|Pilotage en langage naturel}}
Une fois la routine en place : *« mets ma routine en pause »*, *« change l'heure »*, *« montre-moi sa dernière exécution »*, *« supprime-la »*. Rien à configurer nulle part.
{{/callout}}

{{callout:warning|Jamais pour votre app}}
Tout ce dont votre **app** a besoin pour fonctionner (nettoyages, emails aux clients, synchronisations) va sur l'infrastructure de l'app : `/add-cron`, `/add-workflow`, ou `/add-automation`. Une routine qui s'arrête ne doit jamais casser autre chose que votre propre confort.
{{/callout}}
