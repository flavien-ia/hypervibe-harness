# /add-agent-dashboard

Ajoute un tableau de bord dans votre espace admin pour suivre et piloter vos agents IA. Vous voyez leurs exécutions, leur coût, leurs décisions, et vous pouvez en lancer manuellement.

## Quand l'utiliser

- Vous avez créé un ou plusieurs agents IA via `/add-agent` et vous voulez les **suivre** depuis votre site
- Vous voulez **déclencher un agent à la demande** (par exemple : *"lance le brief RSS maintenant"*)
- Vous voulez **comprendre les décisions** de vos agents (tour par tour, quel outil utilisé, quel résultat)
- Vous voulez voir **combien coûte** chaque agent en USD

## Comment ça se passe

1. **Vérifications** : Hypervibe vérifie deux prérequis :
  - **Authentification admin** : votre site doit avoir `/add-auth` configuré en mode admin (le dashboard est privé)
  - **Au moins un agent existant** : il faut au moins une exécution de `/add-agent` avant pour que les tables `agent_*` existent en base
   
   Si l'un manque, Hypervibe vous explique et s'arrête.

2. **Scaffolding** : Hypervibe copie 4 pages dans `apps/web/src/app/admin/agents/` :
  - **Liste des agents** : tableau récap avec nom, dernier déclenchement, coût cumulé, taux de succès/erreur
  - **Détail d'un agent** : historique de toutes ses exécutions (invocations), avec leur statut, durée, coût
  - **Détail d'une invocation** : la **chaîne de pensée complète** : chaque tour de l'agent, le texte généré, les outils appelés, les résultats des outils, le coût du tour
  - **Formulaire de déclenchement manuel** : un champ texte pour entrer un prompt custom, un bouton "Lancer". L'agent reçoit le prompt et s'exécute immédiatement.

3. **Création du router tRPC** : `agent-dashboard.ts` est ajouté à votre API, avec les procédures pour lister, filtrer, déclencher (toutes protégées par `adminProcedure`).

4. **Enregistrement du router** : `root.ts` est patché pour inclure le nouveau router.

5. **Idempotence** : si vous relancez `/add-agent-dashboard` plus tard, Hypervibe détecte les fichiers déjà en place et les laisse intacts. Pas de risque de doublon.

## Ce que ça crée pour vous

- 4 pages dans votre espace admin :
 - `/admin/agents` (liste)
 - `/admin/agents/[name]` (détail d'un agent)
 - `/admin/agents/[name]/invocations/[id]` (chaîne de pensée d'une exécution)
- Un nouveau router tRPC `agent-dashboard` pour les données
- Un menu "Agents IA" à ajouter à votre admin sidebar (Hypervibe vous propose)

## Prérequis

- L'authentification admin doit être configurée (`/add-auth` en mode admin)
- Au moins un agent doit avoir été créé (`/add-agent`)

## Astuces

{{callout:tip|"Lancer maintenant" = très pratique pour tester}}
Le bouton de déclenchement manuel est précieux quand vous développez un agent : vous pouvez tester un prompt custom sans attendre l'horaire automatique. Si l'agent plante ou se comporte bizarrement, vous voyez immédiatement la chaîne de décision dans le détail de l'invocation et vous diagnostiquez en quelques secondes.
{{/callout}}

{{callout:info|Vos agents apparaissent tout seuls}}
Vous n'avez rien à configurer dans le dashboard quand vous créez un nouvel agent : `/add-agent` enregistre déjà toutes les données nécessaires (exécutions, décisions, coûts) au fil de l'eau. Le nouvel agent apparaît automatiquement dans la liste dès sa première exécution.
{{/callout}}

{{callout:warning|Dashboard = admin only}}
Toutes les routes du dashboard sont protégées par `adminProcedure`. Seul votre login admin peut accéder à `/admin/agents`. Vos utilisateurs réguliers (mode "users" de `/add-auth`) ne peuvent pas voir cette page. C'est intentionnel, l'historique des agents peut contenir des données sensibles.
{{/callout}}
