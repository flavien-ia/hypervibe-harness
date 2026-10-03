# /accessibility

Vérifie que votre application sert bien les personnes qui voient, entendent, bougent ou lisent autrement, et corrige ce que vous approuvez. Hypervibe lit votre code, mesure vos pages en ligne, explique chaque problème en mots simples (ce que c’est, qui il exclut), puis applique les corrections que vous validez.

## Quand l’utiliser

- Avant un lancement, pour que **tout le monde puisse utiliser** votre application : les personnes aveugles ou malvoyantes, celles qui ne peuvent pas se servir d’une souris, celles qui ont du mal à lire
- Votre activité vend à des particuliers dans l’Union européenne : depuis le 28 juin 2025, l’**European Accessibility Act** fait de l’accessibilité une obligation pour de nombreux services numériques (les micro-entreprises qui fournissent des services en sont exemptées)
- Après `/seo` : les moteurs de recherche lisent la même structure qu’un lecteur d’écran, accessibilité et visibilité vont ensemble

## Comment ça se passe

1. **La lecture du code** : Hypervibe parcourt toutes les pages, y compris celles derrière une connexion qu’aucune mesure extérieure n’atteint. Il repère ce qui exclut quelqu’un : une image sans texte de remplacement, un bouton qui n’est qu’une icône sans nom, un champ de formulaire sans étiquette, un élément cliquable que le clavier n’atteint pas, un contour de focus supprimé, le zoom bloqué sur mobile, des titres qui sautent un niveau.

2. **La mesure des pages en ligne** : si votre site est en ligne, 3 à 5 pages représentatives sont mesurées par les serveurs de Google. Vous obtenez un score d’accessibilité sur 100, et ce que seule une page affichée révèle, les contrastes de couleur d’abord. La clé Google est la même que pour `/seo-perf` et `/eco-audit`.

3. **Les vérifications que seule une personne peut faire** : naviguer au clavier seul, zoomer à 200 %, et si vous le souhaitez, écouter une page avec le lecteur d’écran de votre ordinateur. Hypervibe vous dit exactement quoi regarder.

4. **Un rapport clair** : le score de chaque page, puis les problèmes du plus grave au plus léger, chacun avec qui il touche, où il se trouve, et le critère international auquel il se rattache (WCAG, niveau A, AA ou AAA).

5. **Les corrections proposées** : regroupées par nature, vous validez chaque lot. Langue de la page, noms des boutons-icônes, étiquettes des champs, textes de remplacement que vous approuvez, navigation au clavier, focus visible, lien « Aller au contenu »... Les choix de design (couleurs, composants complexes) restent les vôtres : vous recevez une proposition, jamais un changement que vous n’avez pas demandé.

6. **Une nouvelle mesure après la mise en ligne** : l’avant/après du score, page par page.

## Ce que ça crée pour vous

- Un rapport d’accessibilité de votre application, code et pages en ligne
- Les corrections que vous avez validées, appliquées au code
- Si vous le demandez, une page de déclaration d’accessibilité, honnête sur l’état de l’application

## Prérequis

- Un projet Next.js créé avec Hypervibe (ou du même type)
- Pour la mesure en ligne : le site en ligne, et la clé gratuite PageSpeed Insights (Hypervibe vous guide pour la créer si elle n’est pas encore dans votre coffre). Sans elle, l’audit lit le code seulement

## Astuces

{{callout:info|Un audit automatique trouve une partie des problèmes}}
Environ un tiers, selon les estimations habituelles. C’est pour cela qu’Hypervibe vous demande les vérifications au clavier et au zoom : cinq minutes, et elles attrapent ce qu’aucun outil ne voit. Un rapport sans problème est un bon début, pas un certificat.
{{/callout}}

{{callout:tip|L’accessibilité aide tout le monde}}
Une étiquette claire, un focus visible, un contraste suffisant : ils aident une personne qui ne voit pas, mais aussi quelqu’un sur son téléphone en plein soleil, ou pressé. Et les moteurs de recherche lisent la même structure.
{{/callout}}

{{callout:warning|Pas de « totalement conforme » sans audit complet}}
Si vous publiez une déclaration d’accessibilité, elle dit honnêtement où en est l’application. Seul un audit complet, fait par des personnes, peut affirmer une conformité totale.
{{/callout}}
