# Changelog

## v2.8.0 (8 août 2026)

### Nouveautés
- **`/optimize`** : une nouvelle commande qui cherche ce qui coûte cher dans ton application, côté serveur. Elle croise ton code avec la consommation réelle de tes services, classe les causes par coût mesuré, et te propose les correctifs un par un, avec leur niveau de confiance et leur dangerosité. Rien n'est modifié sans ton accord.

### Améliorations
- **Bonnes pratiques de lecture en base, posées par `/start`** : elles rejoignent les règles de ta configuration globale, donc elles s'appliquent à tous tes projets. Le quota qui saute en premier sur les offres gratuites, c'est le volume de données que ta base renvoie, et il se mesure au nombre de lectures multiplié par ce que chacune rapporte, pas à la taille de la base. Une petite base lue souvent coûte plus cher qu'une grosse base lue rarement.
- **`/add-db`** explique désormais comment écrire une requête qui ne coûte rien : ne demander que les colonnes réellement affichées, borner les listes, et éviter les rafraîchissements en boucle qui ne s'arrêtent jamais. Ces règles sont écrites dans la mémoire du projet, donc elles s'appliquent à chaque fois que tu y travailles.
- **`/security`** rend son rapport plus concret, avec un exemple complet de ce à quoi ressemble une faille expliquée en français courant, conséquence et correctif compris.

## v2.7.9 (7 août 2026)

### Nouveautés
- **Vérification du stockage** : `/add-storage` teste maintenant votre bucket pour de vrai avant d'annoncer que le stockage fonctionne. Il liste quelques fichiers, signe une URL, et vous dit précisément quoi corriger si quelque chose cloche (clés refusées, bucket introuvable, mauvaise région).

### Améliorations
- **`/add-agent` propose les modèles actuels** : le choix se fait désormais entre Claude Sonnet 5, Opus 5 et Haiku 4.5. Jusqu'ici les agents étaient créés sur une génération précédente, sans que rien ne le signale.
- **Coûts justes pour les agents Haiku** : le suivi de dépense d'un agent Haiku affichait un montant trois fois trop élevé.
- **Écart de prix annoncé correctement** : passer un agent en Opus coûte environ 1,7 fois le prix de Sonnet, et non 5 fois comme l'indiquait le questionnaire.

### Coulisses
- Table de tarification complétée pour le modèle Claude Fable 5.
- Les briques dont la version est volontairement figée (cartes, planificateur de tâches, TypeScript) portent maintenant dans le code la raison du gel et la condition pour le lever.

## v2.7.8 (6 août 2026)

### Améliorations
- **Création d'une routine** : quand la mission peut tourner aussi bien sur l'ordinateur que dans le cloud, le plugin ne tranche plus en silence. Il pose la question et recommande l'ordinateur par défaut : une routine locale hérite de tout ce qui marche déjà chez toi (coffre-fort de clés, fichiers du projet, outils installés, comptes connectés), alors qu'une routine cloud repart de zéro et oblige à redéposer des clés de son côté. Le cloud n'est proposé que pour le cas qui le justifie vraiment : une mission qui doit tourner ordinateur éteint.

## v2.7.7 (5 août 2026)

### Nouveautés
- **`/update-hypervibe`** : met Hypervibe à jour sans quitter votre conversation. La commande commence par regarder comment vous avez installé le plugin. Si vous l'avez ajouté par une commande, Claude Code le tient déjà à jour tout seul : elle vous le dit et vous donne la commande native, plutôt que d'agir dans son dos. Si vous aviez téléversé le zip dans Claude Desktop, elle compare votre version à la dernière publiée, télécharge la nouvelle, vérifie qu'il s'agit bien d'un plugin complet avant de toucher à votre installation, puis la remplace en gardant l'ancienne en sauvegarde juste à côté.

### Coulisses
- Une mise à jour qui échoue ne vous laisse jamais sans plugin : la version précédente est remise en place d'elle-même, et la commande vous dit ce qui a échoué. L'archive téléchargée est aussi inspectée avant d'être déballée, pour qu'aucun fichier ne puisse s'écrire ailleurs que dans le dossier du plugin.

## v2.7.6 (5 août 2026)

### Nouveautés
- **Trois services de plus dans votre politique de confidentialité** : le fournisseur de cartes, le service qui achemine les notifications push, et la redirection d'emails d'un nom de domaine. Tous les trois voient passer des données de vos visiteurs et n'étaient jamais mentionnés.

### Améliorations
- **La carte se déclare enfin** : `/add-map` était censée inscrire son fournisseur de cartes dans votre politique, mais l'étape ne pouvait pas aboutir. Résultat, chaque site avec une carte omettait le service qui reçoit l'adresse IP de ses visiteurs à chaque page. C'est réparé.
- **`/rgpd-audit` pose les questions que le code ne peut pas trancher** : certains services se configurent chez le fournisseur et ne laissent aucune trace dans votre projet, une adresse `contact@` redirigée par exemple. L'audit les demande maintenant, une seule fois.
- **Il ne propose plus de supprimer une mention pourtant juste** : ces mêmes services, invisibles pour lui, ressortaient comme obsolètes à chaque passage. Une politique « corrigée » de cette façon finissait par mentir.
- **`/add-push-notification` et `/new-email-address`** déclarent désormais le service qu'elles mettent en place.

### Coulisses
- Le registre des sous-traitants distingue ce qui se détecte automatiquement de ce qui se déclare à la main.

## v2.7.5 (5 août 2026)

### Améliorations

- **Une tâche planifiée qui échoue vous prévient enfin.** Quand l'horloge partagée appelle votre site et reçoit une erreur (clé périmée, adresse renommée, application qui plante), la tâche n'a tout simplement pas lieu, et elle ne se rattrape pas toute seule. Jusqu'ici l'échec ne partait que dans des journaux que personne ne lit. Vous recevez maintenant un mail qui nomme la tâche, la cause, et la piste la plus probable, au maximum une fois toutes les 6 heures tant que la panne dure. Sur une installation existante, lancez `/quotas` une fois pour activer la surveillance.

- **Render : le plan gratuit dit enfin la vérité.** Chez Render, le plan gratuit n'existe pas pour les processus permanents. `/add-automation` vous fait donc choisir en amont entre un service gratuit réveillé par l'horloge (endormi entre deux passages, parfait pour du travail lourd mais ponctuel) et un vrai processus permanent à environ 7 USD par mois, seul capable de ne rien manquer. Et `/add-agent` annonce désormais que la facture démarre le jour du déploiement, pas au premier travail de l'agent.

- **Plus de faux échecs sous Windows.** `/add-db` et `/add-agent` pouvaient renvoyer un code d'erreur incohérent juste après un appel réseau, ce qui empêchait de reprendre l'installation là où elle s'était arrêtée. Corrigé.

### Coulisses

- L'audit RGPD reconnaît Render quel que soit le type de service hébergé : le sous-traitant est le même.

## v2.7.4 (3 août 2026)

### Correctifs
- **Les commits ne sont plus bloqués quand votre nom d'utilisateur Windows contient une espace** : le contrôle anti-fuite de secrets installé par `/start` ne trouvait plus sa configuration, et refusait alors *tous* les commits, sur *tous* vos projets. Relancez `/start` pour réparer une machine déjà touchée.
- **Les tâches planifiées se déploient sans compte public Cloudflare** : la mise en ligne échouait tant qu'on n'avait pas créé un sous-domaine public, alors que ces tâches ne répondent à aucune adresse web. Corrigé pour les tâches partagées comme pour celles propres à un projet.
- **Identification du compte Cloudflare plus robuste** : quand la clé d'accès ne permet pas de lister les comptes, le plugin retrouve l'identifiant autrement. En cas d'échec, le message dit désormais quelle permission manque et où trouver l'identifiant à la main.

### Coulisses
- Merci à Manuel Ferreira pour deux rapports de bug précis, reproduits à l'identique.

## v2.7.3 (2 août 2026)

### Corrections
- **Suppression de projet : les fichiers stockés étaient oubliés.** `/delete-project` annonçait "aucun espace de stockage" pour absolument tous les projets, à cause d'un accès Cloudflare qui échouait en silence. Les espaces de stockage survivaient donc à la suppression, et continuaient d'être facturés. Ils sont désormais retrouvés dans les deux juridictions (mondiale et européenne), avec leur contenu annoncé ("543 fichiers, 84 Mo") avant que vous validiez.
- **Suppression de projet : sites Vercel introuvables.** Seuls les 20 projets les plus récents étaient examinés. Au-delà, votre site était déclaré inexistant et restait en ligne. Tous vos projets sont maintenant passés en revue.
- **Un espace de stockage non vide peut enfin être supprimé** : son contenu est effacé automatiquement juste avant.
- **Sauvegarde de projet : fichiers manquants.** `/save-project` produisait une archive sans aucun fichier uploadé lorsque les clés de stockage n'étaient pas dans le projet, sans jamais le signaler. Le contenu est maintenant récupéré dans tous les cas.

### Améliorations
- **Une vérification qui échoue ne se lit plus comme "rien à supprimer"** : coffre verrouillé, accès expiré, le problème est annoncé clairement avant que vous validiez la suppression.
- **Migration vers le stockage européen simplifiée** (`/add-storage`) : procédure deux fois plus courte, sans copie aller-retour inutile. Deux pièges documentés au passage : la clé d'accès est à régénérer, et l'adresse publique des fichiers change.

## v2.7.2 (2 août 2026)

### Améliorations
- **Paiements Stripe** : la version d'API n'est plus figée dans le plugin, elle est lue dans le SDK au moment de l'installation. Les projets créés avec `/add-stripe` compilent de nouveau, quelle que soit la date à laquelle vous les créez.
- **Agents** : `/add-agent` demande à Anthropic quel est son modèle le plus récent au lieu d'en garder un codé en dur, et le modèle retenu arrive vraiment dans l'agent généré (l'option `--model` restait sans effet).
- **Coût de la base de données** : `/add-cron` vous prévient quand une cadence trop serrée maintient la base Neon éveillée en permanence, et le relevé de consommation affiche enfin le temps de calcul réel (il indiquait toujours 0 h).
- **Déclenchement manuel d'un agent** : l'agent n'interroge plus sa file d'attente toutes les 5 secondes en continu. Il reste réactif pendant sa fenêtre d'activité puis espace ses vérifications à 10 minutes au repos, ce qui laisse la base s'endormir. Un agent au repos peut donc mettre jusqu'à 10 minutes à démarrer, le tableau de bord affiche « en file ».
- **Notifications** : la cloche se rafraîchit à l'instant où une notification arrive, via le service worker, au lieu d'interroger le serveur toutes les 30 secondes.
- **Surveillance** : le worker partagé surveille aussi les quotas Neon (trafic sortant, calcul, stockage) et prévient par email quand une sauvegarde de base échoue.

### Coulisses
- Les types du SDK Anthropic sont pris sur sa surface publique et non plus sur un chemin interne : les agents générés ne cassent plus quand le paquet réorganise ses fichiers.

## v2.7.1 (1er août 2026)

### Corrections
- **Fenêtre de saisie des clés** : en français, le message de confirmation affiché une fois la clé enregistrée pouvait se lire comme une consigne à exécuter vous-même plutôt que comme une confirmation que c'était fait. Les phrases concernées ont été reformulées, à la fin de l'enregistrement comme à l'ouverture du coffre-fort.

## v2.7.0 (1er août 2026)

### Nouveautés
- **Vos clés d'accès ne passent plus par la conversation** : dès qu'une clé ou un mot de passe est nécessaire, une petite fenêtre s'ouvre sur votre ordinateur pour la saisie. La valeur part ensuite soit dans votre coffre-fort, soit dans les réglages de votre projet. Plus rien n'est écrit dans le fil de discussion, qui lui reste consultable longtemps après.
- **La fenêtre de saisie parle votre langue** : français ou anglais selon la langue de votre conversation, y compris à la création du coffre-fort et à son ouverture quotidienne.

### Améliorations
- **Suivi des quotas** : la partie base de données restait vide quand vous aviez beaucoup de projets. Elle s'affiche maintenant correctement, et un message clair remplace l'erreur technique quand un service met trop de temps à répondre.
- **Passage d'un site en plusieurs langues** : sous Windows, le serveur d'aperçu bloquait la réorganisation des pages. Il est désormais arrêté puis relancé automatiquement.
- **Mise en ligne** : la vérification qu'un déploiement a bien abouti ne s'interrompt plus au bout de deux minutes.

### Coulisses
- Nouvelle brique interne de collecte des secrets, qui remplace la précédente, et correction de chemins de modèles dans l'ajout de comptes utilisateurs.

## v2.6.4 (31 juillet 2026)

### Améliorations
- **Claude te parle dans ta langue dès la première question** : jusqu'ici, lancer une commande seule (par exemple `/bootstrap`, sans rien écrire d'autre) faisait démarrer Claude en anglais, faute d'indice sur ta langue. Il se base désormais sur l'ensemble de la conversation et, à défaut, sur la langue de ton ordinateur. Le changement porte sur toutes les commandes du plugin.
- **Suppression d'un projet** : Claude ne demande plus s'il faut supprimer l'espace de stockage de fichiers quand le projet n'en a pas. La question n'apparaît que s'il en existe vraiment un.

### Suppressions
- **`/save-config`** (sauvegarde de ta configuration Claude vers un dépôt privé) : retirée du plugin. Elle avait été ajoutée la veille et n'a pas été retenue.

### Coulisses
- Consigne de langue harmonisée sur les 82 commandes du plugin, y compris les commandes internes appelées par les autres.

## v2.6.3 (30 juillet 2026)

### Améliorations
- **Documentation de `/save-config`** : la commande de sauvegarde de ta configuration a désormais sa fiche complète, en français et en anglais, avec ce qu'elle copie exactement, ce qu'elle ne copie jamais, et la marche à suivre le jour où tu dois tout remonter sur une machine neuve. Elle est rangée dans la catégorie Outils.

## v2.6.2 (30 juillet 2026)

### Nouveautés
- **Sauvegarde de ta configuration** : la nouvelle commande `/save-config` met à l'abri tout ce que Claude sait de toi et de tes projets (tes règles, tes skills, sa mémoire, tes plugins) dans un dépôt GitHub privé qui t'appartient. Elle archive aussi ton historique de conversations et l'état de ta barre de gauche dans ton cloud (Dropbox, OneDrive, iCloud, Google Drive, Nextcloud). Tes clés n'en font jamais partie : elles restent dans ton coffre. Au passage, elle te propose de programmer cette sauvegarde tous les jours, pour ne plus jamais y penser.

### Améliorations
- **Première installation** : `/start` propose désormais de mettre en place cette sauvegarde une fois ton environnement prêt. Une question, une réponse, c'est réglé. Si tu dis non, il n'insiste pas.

### Coulisses
- Le fichier de réglages est sauvegardé avec les valeurs de son bloc `env` masquées : c'est l'endroit où une clé API atterrit par accident, et le dépôt de sauvegarde part sur GitHub.

## v2.6.1 (30 juillet 2026)

### Corrections
- **Cartes** : les cartes ajoutées avec `/add-map` ne s'affichaient plus et faisaient planter la page avec un message d'erreur. En cause, une nouvelle version de MapLibre (la brique qui dessine les cartes) publiée le 22 juillet, devenue incompatible avec la couche React utilisée par le plugin. L'installation s'appuie désormais sur la dernière version stable compatible. Un projet déjà touché se répare en relançant `/add-map`. Le piège est documenté pour qu'il ne revienne pas.

### Améliorations
- **Création de projet** : `/bootstrap` ne décide plus tout seul de créer un dossier `DEV` à la racine du disque. Il regarde d'abord où vous rangez déjà vos projets, y compris sur le Bureau ou dans OneDrive, et vous demande confirmation quand plusieurs emplacements sont possibles. Fini le projet créé dans un dossier introuvable.

## v2.6.0 (25 juillet 2026)

### Nouveautés
- **Vérification de déploiement** : Claude peut désormais attendre proprement qu'une mise en ligne Vercel se termine, et te dire si elle est prête, en échec ou trop longue. Avant, l'attente mourait au bout de deux minutes et il fallait aller vérifier à la main.

### Améliorations
- **`/start` ne gèle plus** : le diagnostic d'installation teste chaque outil avec son propre délai maximum. Un service injoignable ne bloque plus tout le rapport, il apparaît simplement en « pas vérifié ».
- **`/security` plus honnête** : l'audit des dépendances ne supprime plus le fichier de verrouillage d'un projet qui en a légitimement un, et il ne présente plus comme réussi un audit qui n'a pas pu tourner.
- **Base de données** : plusieurs commandes SQL envoyées d'un coup fonctionnent enfin, et de façon atomique : soit tout s'applique, soit rien. Une modification de base ne peut plus rester à moitié faite.

### Coulisses
- Connexion Vercel mutualisée entre les outils internes, avec repli automatique quand le jeton d'accès a expiré.
- Dépendances du modèle d'agent mises à jour.

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
