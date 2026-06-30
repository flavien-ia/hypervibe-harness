# /seo-perf

Mesure la vitesse réelle de votre site avec PageSpeed Insights, l'outil officiel de Google. Quelques pages représentatives sont chargées comme par un vrai visiteur, vous obtenez des notes (vitesse, accessibilité, SEO) et les Core Web Vitals, puis des corrections concrètes triées par impact mesuré.

## Quand l'utiliser

- Vous voulez savoir si votre site est **rapide pour de vrai** (pas une impression, des chiffres mesurés par Google)
- Vous venez de faire `/seo` et voulez **confronter le résultat** à une mesure objective (proposé automatiquement en fin de `/seo`)
- Quelques semaines après le lancement, pour voir les **données de vos vrais visiteurs** (Core Web Vitals de terrain)

## Comment ça se passe

1. **Vérifications** : le site doit être déployé (on mesure le site en ligne, pas le code local). À la première utilisation, Hypervibe vous guide pour créer une clé Google gratuite (2 minutes, une seule fois pour tous vos projets, rangée dans votre coffre-fort).

2. **Choix des pages représentatives** : on n'audite pas tout le site. Les pages d'un même type (template) ont la même performance, donc Hypervibe sélectionne 3 à 5 pages types (accueil, listing, formulaire...) et mesure en mobile d'abord (c'est ce que Google regarde).

3. **Mesure** : chaque page est chargée par les serveurs de Google (15 à 30 secondes par page), après un "réveil" du site pour ne pas mesurer un faux départ à froid.

4. **Rapport** : un tableau clair par page (notes sur 100, temps d'affichage, stabilité visuelle), avec l'explication concrète de chaque problème et la distinction entre vrai problème et bruit de mesure.

5. **Corrections proposées** : triées par gain estimé. Vous validez ce que vous voulez appliquer ; les changements risqués ou de design restent entre vos mains.

6. **Re-vérification** : après déploiement des corrections, une nouvelle mesure montre l'avant/après chiffré.

## Ce que ça crée pour vous

- Un rapport de performance chiffré par page (scores + Core Web Vitals)
- Les corrections validées appliquées au code
- Une clé PageSpeed Insights réutilisable dans votre coffre-fort (première fois uniquement)

## Prérequis

- Un site **déployé** (l'audit mesure le site en ligne)
- Une clé Google PageSpeed gratuite (création guidée à la première utilisation)

## Bon à savoir

- Sur un site neuf, les mesures viennent du "labo" de Google. Avec du trafic réel (quelques semaines), l'audit affiche en plus les **Core Web Vitals de terrain** : la vitesse vécue par vos vrais visiteurs. Relancer `/seo-perf` plus tard apporte donc des informations nouvelles.
- Les Core Web Vitals sont un **facteur de classement Google confirmé** : améliorer ces chiffres aide votre référencement.
