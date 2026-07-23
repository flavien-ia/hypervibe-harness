# Changelog

## v2.5.5 (23 juillet 2026)

### Nouveautés
- **`/add-routine`** : confier une mission récurrente à votre propre Claude (un brief chaque matin, une analyse le vendredi, une veille qui vous alerte). Aucun code, aucune infrastructure : la routine tourne sur votre compte Claude, au rythme que vous choisissez.
- **`/add-workflow`** : ajouter à votre app un enchaînement d'étapes déclenché par un événement (un document déposé, un formulaire envoyé, un paiement reçu), avec des étapes intelligentes là où il en faut. Tout tourne dans votre app, et chaque exécution est tracée étape par étape dans votre base. C'est ce que beaucoup de gens appellent « un agent », sans qu'un agent soit nécessaire.

### Améliorations
- **`/add-automation`** oriente maintenant vers ces deux nouvelles portes : une mission récurrente pour vous part en routine Claude, une chaîne déclenchée par un événement part en workflow, et les traitements lourds ou continus restent sur un vrai worker (Cloudflare ou Render).
- **`/save-project`** : les sauvegardes récupèrent enfin le contenu de votre stockage de fichiers dans tous les cas (lecture directe avec les clés de votre projet, sans dépendre d'un outil en ligne de commande), et le téléchargement est nettement plus rapide. La sauvegarde de la base de données fonctionne à nouveau avec les versions récentes du pilote Neon. Surtout, une sauvegarde qui se retrouverait vide s'annonce désormais comme une erreur au lieu de passer pour un succès.

## v2.5.4 (16 juillet 2026)

### Améliorations
- **Le coffre-fort fait autorité sur les réglages de ton ordinateur** : si une ancienne clé d'accès traînait encore dans les réglages de ta machine (comme en posaient les versions d'avant le coffre-fort), elle pouvait passer devant le coffre sans rien dire. Résultat possible : Hypervibe installait les tâches de fond sur le mauvais compte Cloudflare, ou branchait les sauvegardes sur la mauvaise base de données, sans afficher la moindre erreur. Le coffre est désormais consulté en premier, et une vieille clé restée en place est ignorée, puis signalée pour que tu puisses la retirer.
- **Plus de repli silencieux quand le coffre est verrouillé** : si Hypervibe a besoin d'une clé alors que ton coffre est fermé, il te le dit clairement au lieu de se rabattre sans prévenir sur une valeur peut-être périmée.

### Coulisses
- Une clé lue plusieurs fois au cours d'une même commande n'est plus redemandée au coffre à chaque fois : elle est gardée en mémoire le temps de la commande. Les opérations qui en consultent plusieurs (sauvegardes, alertes de quota) s'en trouvent accélérées.

## v2.5.3 (16 juillet 2026)

### Améliorations
- **Suppression de projet (`/delete-project`)** : la confirmation finale, où l'on retape le nom du projet, échouait et bloquait la skill. Elle se fait désormais par une simple réponse dans le chat. La double vérification avant toute suppression reste inchangée.
- **Fiabilité sous Windows** : la suppression de projet et le changement de serveurs de noms chez Hostinger écrivaient leurs fichiers de travail à un endroit introuvable sous Windows, ce qui les faisait échouer. Les chemins sont maintenant calculés pour fonctionner sur Windows comme sur Mac, et les messages d'erreur des services sont affichés en clair.

### Coulisses
- Nettoyage de la documentation interne de la mise en place de l'email : elle décrivait encore une ligne de commande Resend abandonnée depuis, alors que la clé est lue dans le coffre-fort et que tout passe par l'API. Aucun changement de comportement.

## v2.5.2 (5 juillet 2026)

### Nouveautés
- **Garde-fou anti-collision de noms** : avant de créer un projet, Hypervibe vérifie que le nom choisi ne se confond pas avec un projet déjà présent sur tes comptes (Neon, Vercel, dossiers voisins, horloge partagée des tâches de fond). Si un nom risque de rendre une suppression future ambiguë (par exemple créer « street » alors que « street-cool » existe déjà), il te prévient et propose des variantes sûres. Objectif : qu’un `/delete-project` n’emporte jamais le mauvais projet.

### Améliorations
- **Migration automatique vers l’horloge partagée** : plus aucune commande à taper. En relançant `/start` après la mise à jour, Hypervibe détecte tout seul les anciens mécanismes de fond (sauvegardes, alertes de quota, tâches planifiées) et les regroupe dans le mécanisme unifié, en toute sécurité et avec ton accord à chaque étape.
- **Suppression de projet plus fiable** : la création et la suppression de projet partagent désormais la même logique de reconnaissance des noms, pour toujours s’accorder sur ce qui « entre en collision ».

### Coulisses
- Fonction de correspondance de noms mutualisée entre les skills, ajustements internes de l’enregistrement des tâches planifiées.

## v2.5.1 (5 juillet 2026)

### Nouveautés
- **Commande `/migrate-workers`** : si vous venez d'une version antérieure à la 2.5, tapez `/migrate-workers` après la mise à jour et Claude regroupe automatiquement vos anciens mécanismes de fond (sauvegardes, alertes de quota, tâches planifiées) dans la nouvelle horloge partagée unifiée. Il vérifie que tout fonctionne par un vrai test avant de retirer quoi que ce soit, et ne supprime rien sans votre accord. Sans effet si vous n'avez rien à migrer.

### Améliorations
- **/start** vous signale désormais s'il détecte d'anciens mécanismes de fond encore en place, et vous invite à lancer `/migrate-workers`.

## v2.5.0 (5 juillet 2026)

### Nouveautés
- **Routines Claude** : les missions récurrentes personnelles (« briefe-moi chaque matin », « analyse ma semaine le vendredi ») peuvent désormais être confiées directement à votre Claude, sans aucune infrastructure. `/add-automation` et `/add-agent` proposent automatiquement cette voie légère quand elle convient.
- **Horloge partagée unifiée** : vos tâches planifiées, vos sauvegardes de base de données et la surveillance des quotas tournent désormais dans un seul mécanisme mutualisé (un seul emplacement Cloudflare pour tous vos projets), versionné et récupérable.
- **Guide de migration** : un fichier MIGRATION.md à donner à Claude Code fait la transition depuis les anciennes versions, proprement et avec votre accord à chaque étape.

### Améliorations
- **/add-automation** : comprend d'abord si la tâche sert votre app ou vous-même, et recommande la bonne solution en expliquant ses raisons.
- **/add-cron** : mise en place plus simple et plus fiable (une seule étape), GitHub en secours si Cloudflare n'est pas configuré.
- **/add-agent** : oriente les missions personnelles vers une routine légère ; l'agent complet reste pour les fonctions de votre produit.
- **/add-backup-db et /quotas** : brancher un projet ou la surveillance se fait en un appel, tout est consigné dans un registre versionné.

### Coulisses
- Nouveau module interne partagé (worker unifié testé de bout en bout, 51 tests), nettoyage de cinq anciens scripts.

## v2.4.2 (4 juillet 2026)

### Améliorations
- **Sites multilingues mieux référencés** : la commande `/add-i18n` génère désormais un balisage SEO correct page par page. Chaque page obtient sa propre URL canonique et ses variantes de langue (hreflang), au lieu d'un balisage global hérité du gabarit qui faisait pointer toutes les pages vers l'accueil (les moteurs voyaient alors chaque page comme un doublon de la page d'accueil). Un nouvel utilitaire `localeAlternates()` pose ces balises directement dans chaque page.

### Coulisses
- Refonte du script d'installation i18n pour appliquer ce nouveau modèle de balisage par page.

## v2.4.1 (2 juillet 2026)

### Améliorations
- **Audit de sécurité (/security)** : la checklist couvre quatre nouvelles familles de failles, parmi les plus fréquentes dans les apps construites vite : l'accès aux données d'un autre utilisateur en changeant un identifiant dans la requête (IDOR), les webhooks non authentifiés (un faux "paiement reçu" Stripe devient impossible), le CSRF sur les routes personnalisées, et le SSRF (empêcher votre serveur d'appeler des adresses internes via une URL fournie par un utilisateur). L'audit vérifie aussi que la version de Next.js n'est pas touchée par une faille critique connue.
- **Correctifs plus sûrs** : l'ajout automatique des headers de sécurité s'insère désormais dans votre configuration existante au lieu de la réécrire. Les projets avec internationalisation, redirections ou options personnalisées ne perdent plus rien.
- **Header obsolète retiré** : X-XSS-Protection (déprécié, potentiellement contre-productif) n'est plus ajouté, et il est retiré s'il était présent d'un audit précédent.
- **Qualité après correction** : la skill vérifie systématiquement que le projet compile et passe le lint après ses corrections.
