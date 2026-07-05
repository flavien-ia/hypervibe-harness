# Changelog

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
