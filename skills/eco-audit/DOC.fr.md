# /eco-audit

Mesure l'empreinte écologique de votre site et propose des corrections concrètes pour l'alléger. Vous obtenez une note EcoIndex (A à G), une estimation du CO2 émis par visite, et le détail de ce qui pèse inutilement.

## Quand l'utiliser

- Vous voulez savoir **ce que pèse vraiment votre site** pour la planète (et pour le forfait data de vos visiteurs)
- Vous voulez un **score citable** : l'EcoIndex est la méthodologie française de référence, citée par le RGESN (le référentiel officiel d'écoconception)
- Après `/seo-perf` : un site rapide n'est pas forcément léger, cet audit voit ce que la vitesse cache

## Comment ça se passe

1. **Vérifications** : le site doit être en ligne (on mesure le site déployé). La clé Google nécessaire est la même que pour `/seo-perf` : si elle est déjà dans votre coffre-fort, zéro configuration.

2. **Mesure** : 3 à 5 pages représentatives sont chargées par les serveurs de Google. Pour chaque page : complexité (taille du DOM), nombre de requêtes, Ko transférés. Ces trois mesures donnent la note **EcoIndex (A à G)** et l'estimation d'impact (grammes de CO2e et eau par visite).

3. **Rapport parlant** : un tableau par page, le détail des gaspillages chiffrés (images trop lourdes, code inutilisé, cache absent, scripts tiers), les fichiers précis qui pèsent le plus, et la mise à l'échelle ("à 1 000 visites/mois, cette page émet l'équivalent de X km en voiture").

4. **Corrections proposées** : triées par Ko économisés. Compression et formats modernes d'images, chargement différé du code lourd, cache, polices allégées... Vous validez chaque patch ; les choix de design (scripts tiers, animations, mode sombre) restent entre vos mains.

5. **Re-mesure après déploiement** : l'avant/après chiffré (note, poids, CO2e).

## Ce que ça crée pour vous

- Un rapport d'éco-conception chiffré par page (EcoIndex, CO2e, poids, détail des gaspillages)
- Les corrections validées appliquées au code
- Un avant/après mesurable à montrer (ou à mettre dans une démarche RSE)

## Prérequis

- Un site **déployé** (l'audit mesure le site en ligne)
- La clé Google PageSpeed du coffre-fort (la même que `/seo-perf` ; création guidée si première fois)

## Bon à savoir

- Les chiffres CO2e/eau sont des **estimations méthodologiques** (formules EcoIndex) : parfaites pour comparer avant/après et situer votre site, pas pour un bilan carbone officiel.
- Le poste n°1 est presque toujours **les images** : c'est aussi le plus facile à corriger, et ça accélère le site au passage. Écologie et performance vont dans le même sens.
