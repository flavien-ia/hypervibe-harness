# Cahier de recette : {{PROJECT_NAME}}

> **« Recette »** : dans le monde professionnel, c'est le moment où celui qui a
> commandé un logiciel le **reçoit** et dit « oui, c'est conforme » ou « non,
> voici mes réserves ». Le mot vient de *recevoir*, rien à voir avec la cuisine.
> Un **cahier de recette** est la liste de ce que l'application doit faire et de
> la façon dont on vérifie chaque point. C'est ce qu'une entreprise exige de ses
> prestataires, et ce qu'on vous demandera le jour où votre application servira
> à quelqu'un d'autre que vous.

Ce document dit ce que l'application doit faire, comment on le vérifie, et qui
valide. Il est lisible sans rien connaître au code, et il est **tenu par le
code** : chaque ligne marquée « test » a un test automatisé qui porte son
identifiant, et rien ne peut être publié tant qu'une fonctionnalité n'a pas sa
vérification (`node scripts/check-recette.mjs`, lancé avant chaque publication).

Si personne n'a à valider cette application aujourd'hui, il sert quand même :
c'est votre mémoire de ce qu'elle doit faire, six mois plus tard, quand vous
aurez oublié.

- **Vérifiée par** : `test` (un test automatisé, lancé par `pnpm test`) ou
  `manuel` (quelqu'un suit le scénario à la main, typiquement une page).
- **Statut** : `à faire`, `ok`, ou `écart` (avec une note). Le statut d'une
  ligne `test` est le résultat du dernier `pnpm test` ; on ne le met pas à jour
  à la main.

Ajouter une fonctionnalité = ajouter une ligne ici, puis son test. Modifier une
fonctionnalité = relire sa ligne. Les identifiants ne sont jamais réutilisés.

| ID | Fonctionnalité | Comment on vérifie | Résultat attendu | Vérifiée par | Statut |
|---|---|---|---|---|---|
| R-01 | L'API répond | Appeler `healthcheck.ping` | `status: "ok"` et un horodatage valide | test | ok |
{{LIGNES}}

## Procès-verbal

*Cette section ne sert que si quelqu'un doit valider l'application : un client,
un responsable, une direction informatique. Si vous construisez pour vous seul,
retirez-la, le reste du cahier garde tout son intérêt.*

Une publication vaut recette provisoire : les tests sont passés (`pnpm test`)
et le cahier est complet (`node scripts/check-recette.mjs`). La recette
définitive est prononcée par la personne qui valide, après avoir suivi les
scénarios manuels sur la version en ligne.

| Date | Version / commit | Qui valide | Décision (avec ou sans réserve) | Réserves |
|---|---|---|---|---|
| | | | | |
