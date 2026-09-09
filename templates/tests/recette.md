# Cahier de recette : {{PROJECT_NAME}}

Ce document dit ce que l'application doit faire, comment on le vérifie, et qui
valide. Il est lisible sans rien connaître au code, et il est **tenu par le
code** : chaque ligne marquée « test » a un test automatisé qui porte son
identifiant, et rien ne peut être publié tant qu'une fonctionnalité n'a pas sa
vérification (`node scripts/check-recette.mjs`, lancé avant chaque publication).

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

Une publication vaut recette provisoire : les tests sont passés (`pnpm test`)
et le cahier est complet (`node scripts/check-recette.mjs`). La recette
définitive est prononcée par la personne qui valide, après avoir suivi les
scénarios manuels sur la version en ligne.

| Date | Version / commit | Qui valide | Décision (avec ou sans réserve) | Réserves |
|---|---|---|---|---|
| | | | | |
