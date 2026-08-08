# /optimize

Trouve ce qui coûte cher dans votre application, côté serveur, et le corrige. Requêtes qui rapportent trop de données, écrans qui interrogent la base en boucle, mises en cache absentes, fichiers servis depuis la base : chaque trouvaille est chiffrée, classée par coût réel, et corrigée seulement si vous validez.

## Quand l'utiliser

- Vous avez reçu une **alerte de quota** sur un de vos services (base de données, stockage, hébergement)
- Votre application **consomme** plus que ce que son trafic laisse imaginer
- Vous voulez un **contrôle périodique**, avant que le compteur ne monte trop
- Vous venez de terminer une grosse fonctionnalité et vous voulez vérifier ce qu'elle coûte

## Comment ça se passe

1. **Mesure d'abord, code ensuite** : Hypervibe commence par regarder ce que vos services consomment réellement, et à quel rythme. Sans ce chiffre, un défaut trouvé dans le code ne veut rien dire. C'est aussi ce qui permet de classer les trouvailles par coût plutôt que par ordre d'apparition.

2. **Recherche des causes connues** : sept familles de problèmes sont passées en revue.
  - **Requêtes trop larges** (on demande tout à la base alors que l'écran n'affiche que quelques colonnes)
  - **Rafraîchissements sans fin** (un écran qui réinterroge la base même quand il ne se passe rien)
  - **Cache manquant** (une page publique recalculée à chaque visite au lieu d'être servie telle quelle)
  - **Fichiers stockés en base** (images, PDF, archives, qui coûtent bien plus cher là que sur un stockage dédié)
  - **Requêtes en cascade** (une liste qui déclenche une requête par élément affiché)
  - **Travail refait à chaque visite** (un calcul lourd qui pourrait être gardé en mémoire)
  - **Trop de travail confié au navigateur** (des morceaux d'interface qui auraient pu être préparés côté serveur)

3. **Lecture ciblée des points chauds** : Hypervibe lit vraiment les fichiers les plus coûteux, pour trouver ce qu'aucune recherche automatique ne voit. C'est là qu'on découvre les cas les plus absurdes, comme une donnée récupérée toutes les quinze secondes et affichée nulle part.

4. **Rapport chiffré** : pour chaque trouvaille, vous voyez :
  - **Ce que c'est**, expliqué en français courant, sans jargon
  - **Niveau de confiance** (ce qu'Hypervibe a vérifié pour en être sûr)
  - **Dangerosité du correctif** (ce qui pourrait casser, et comment vous le verriez)
  - **Gain estimé**, en mégaoctets par jour ou en gigaoctets par mois, avec le calcul
  - **Le correctif proposé**, en une phrase

5. **Vous validez trouvaille par trouvaille** : à la carte, jamais en bloc. Sur tout ce qui touche à la réactivité d'un écran, Hypervibe vous pose la question plutôt que de décider à votre place.

6. **Application sur une branche séparée** : un correctif par validation, vérification automatique du code, puis vous testez avant de merger.

## Ce que ça crée pour vous

- Une branche `optimize-*` avec les correctifs validés, un par un, annulables séparément
- Un rapport lisible de ce que consomme votre application et de ce qui reste à gagner
- Un chiffre de référence à comparer quelques jours plus tard, pour vérifier que ça a marché

## Prérequis

- Aucun prérequis particulier, `/optimize` tourne sur n'importe quel projet du plugin
- S'il n'y a pas de base de données, les familles qui la concernent sont simplement sautées, et Hypervibe vous le dit
- Mieux vaut avoir Git propre avant de lancer, pour ne pas mélanger vos changements en cours avec les correctifs

## Astuces

{{callout:info|Ce n'est pas la taille de votre base qui coûte, c'est le nombre de lectures}}
C'est le point le moins intuitif, et celui qui piège tout le monde. Votre forfait ne compte pas « quelle taille fait ma base », il compte « combien elle a envoyé ». Une base minuscule lue mille fois par jour coûte beaucoup plus cher qu'une grosse base lue dix fois. C'est pour ça qu'un projet sans aucun trafic peut consommer le forfait de tous vos autres projets.
{{/callout}}

{{callout:warning|Un onglet oublié sur un second écran consomme toute la journée}}
Un tableau de bord laissé ouvert continue d'interroger votre base même si personne ne le regarde : pour le navigateur, un onglet visible sur un écran secondaire reste visible. C'est une des causes les plus fréquentes de facture inattendue, et une des plus faciles à corriger.
{{/callout}}

{{callout:tip|Un écran plus réactif ne passe jamais par un rafraîchissement plus rapide}}
Si vous voulez qu'un écran réagisse à l'instant, la bonne réponse est de le prévenir quand quelque chose change, pas de lui faire poser la question plus souvent. Hypervibe vous proposera toujours cette voie-là en premier.
{{/callout}}

{{callout:info|La différence avec /eco-audit et /clean}}
`/eco-audit` regarde ce que le navigateur télécharge et affiche (images, scripts, vitesse ressentie). `/clean` cherche ce qui ne sert plus et peut être supprimé. `/optimize` regarde ce que le serveur fait et ce que ça consomme. Les trois sont complémentaires et ne se marchent pas dessus.
{{/callout}}
