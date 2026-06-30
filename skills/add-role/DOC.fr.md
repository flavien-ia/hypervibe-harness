# /add-role

Ajoute un **système de rôles utilisateurs** pour différencier les droits d'accès dans votre app. Chaque utilisateur peut avoir un ou plusieurs rôles (`membre`, `editeur`, `moderateur`, etc.), et certaines pages ou fonctionnalités peuvent leur être réservées.

## Quand l'utiliser

- Vos utilisateurs n'ont pas tous les mêmes droits : certains lisent, d'autres publient, d'autres modèrent
- Vous voulez un système d'**abonnement** avec différents niveaux (`free`, `pro`, `enterprise`)
- Vous voulez une équipe interne avec des permissions distinctes (`agent`, `superviseur`)
- Vous voulez une **page d'administration** pour changer le rôle de chaque utilisateur depuis un tableau

## Comment ça se passe

1. **Vérifications** : Hypervibe vérifie que vous avez bien une base de données et un système de comptes utilisateurs (`/add-auth` en mode users). Si l'auth admin manque, elle la pose en amont automatiquement pour que la page de gestion soit protégée.

2. **Choix des rôles** : Hypervibe vous propose une liste adaptée à votre projet (par exemple `membre, editeur, moderateur` pour un site éditorial, `acheteur, vendeur, moderateur` pour une marketplace). Vous acceptez ou vous donnez la vôtre.

3. **Rôle par défaut** : Hypervibe vous demande quel rôle recevra chaque nouveau visiteur qui s'inscrit (typiquement le plus restreint, par exemple `membre`).

4. **Migration des utilisateurs existants** (s'il y en a) : Hypervibe vous demande quel rôle attribuer à vos utilisateurs déjà inscrits.

5. **Mise en place automatique** :
  - Ajout du type "rôle" en base (Postgres `enum`)
  - Ajout de la colonne `roles` sur la table des utilisateurs
  - Création des helpers `hasRole`, `getRoles` réutilisables partout dans votre code
  - Branchement des rôles dans le système de connexion (NextAuth) : chaque session connaît les rôles de l'utilisateur
  - La procédure d'inscription assigne automatiquement le rôle par défaut aux nouveaux comptes
  - Création de la page `/admin/users` : tableau de tous vos utilisateurs avec un menu déroulant par ligne pour changer leur rôle, plus une option "Mode multi-rôle" si certains utilisateurs en cumulent plusieurs

## Ce que ça crée pour vous

- Un **type Postgres `user_role`** avec la liste de vos rôles
- Une colonne **`roles`** (tableau de rôles) sur la table des utilisateurs
- Le fichier **`src/lib/roles.ts`** qui expose les helpers `hasRole(session, [...])`, `getRoles(session)`, et la liste des libellés français pour l'UI
- Une **mise à jour du système de connexion** : les rôles sont disponibles dans `session.user.roles` côté client et serveur
- Une **page admin `/admin/users`** : liste des comptes, recherche, filtre par rôle, dropdown de changement (single ou multi)
- Une **procédure tRPC sécurisée** pour modifier les rôles, accessible uniquement à l'admin global
- Une **mise à jour du `CLAUDE.md`** du projet : la convention rôles est documentée pour que les futures évolutions respectent le pattern

## Prérequis

- Le projet doit avoir `/add-auth` en mode **users** (comptes utilisateurs en base)
- La base de données doit être branchée (`/add-db` lancé)
- Si vous voulez la page de gestion (la plupart du temps oui), `/add-auth` en mode admin sera lancé en amont par Hypervibe si manquant

## Astuces

{{callout:tip|Le rôle `admin` est volontairement réservé}}
Le nom `admin` est réservé au login admin global de votre app (configuré par `/add-auth` en mode admin, stocké en variable d'environnement, pas en base). Hypervibe refuse de l'ajouter à la liste des rôles utilisateurs. Pour un rôle DB équivalent en pouvoir, utilisez `moderateur`, `manager`, ou `superviseur`. Ça garantit qu'il n'y aura jamais de confusion entre les deux notions.
{{/callout}}

{{callout:tip|Un seul rôle au début, multi-rôle plus tard si besoin}}
Par défaut la page admin propose un menu déroulant simple (un seul rôle par utilisateur), suffisant dans la majorité des cas. Si vous avez besoin qu'un utilisateur cumule plusieurs rôles (par exemple `editeur` ET `moderateur`), cochez "Mode multi-rôle" en haut de la page : le dropdown devient une liste à cases à cocher. La mécanique sous-jacente accepte les deux modes sans changement de structure.
{{/callout}}

{{callout:info|Faire évoluer vos rôles plus tard}}
Vous pouvez relancer `/add-role` à tout moment pour ajouter un nouveau rôle, en supprimer un, renommer, ou changer le rôle par défaut. Hypervibe détecte la configuration existante et vous propose un menu adapté. Pour les opérations destructives (suppression d'un rôle), elle vous demande toujours vers quel autre rôle réassigner les utilisateurs concernés.
{{/callout}}

{{callout:info|Pour protéger une page ou une action par rôle}}
Vous n'avez pas à manipuler les helpers vous-même. Dites simplement à Hypervibe : *"protège la page X pour les modérateurs uniquement"*, ou *"seuls les utilisateurs `pro` peuvent appeler cette fonction"*. Le pattern à suivre est documenté dans le `CLAUDE.md` du projet, donc Claude l'applique tout seul à chaque nouvelle page que vous lui demandez.
{{/callout}}
