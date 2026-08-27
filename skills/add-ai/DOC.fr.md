# /add-ai

Ajoute de l'**intelligence artificielle** dans votre application : un assistant qui répond à vos utilisateurs, une analyse automatique de vos contenus, ou de la rédaction. Le coût est calculé et validé **avant** la moindre ligne de code, et la clé créée pour votre projet porte un **plafond de dépense** qu'aucun bug ne peut franchir.

## Quand l'utiliser

- Vous voulez un **assistant conversationnel** dans votre application, qui répond aux questions de vos utilisateurs
- Vous voulez **classer, extraire ou résumer** automatiquement ce qui arrive (messages, documents, formulaires)
- Vous voulez **générer du texte** à partir de vos données (descriptions, résumés, brouillons)
- Vous ne voulez pas découvrir le coût de l'IA sur une facture en fin de mois

## Comment ça se passe

1. **Quatre questions, pas plus.** Ce que l'IA doit faire, qui va s'en servir, à peu près combien de fois par jour, et si des données personnelles y passeront. Hypervibe en déduit la bonne approche : un assistant en direct, un traitement automatique, ou de la génération.

2. **Le coût, avant tout le reste.** Hypervibe lit les **prix réels du moment** chez le fournisseur et vous montre un tableau : ce que coûte une utilisation, ce que ça fait par mois à votre volume, dans deux gammes de modèles. Vous dites oui à un montant, pas à une idée. Rien n'est installé avant votre accord.

3. **Le compte OpenRouter.** C'est le fournisseur retenu : une seule clé donne accès à des centaines de modèles, sans marge sur les prix. La première fois, Hypervibe vous guide pour créer le compte et déposer une clé au coffre-fort. Ensuite, tous vos futurs projets se servent tout seuls.

4. **La clé du projet, plafonnée.** Hypervibe crée une clé dédiée à ce projet, avec la limite de dépense que vous avez validée, et l'installe. La valeur ne passe jamais par la conversation.

5. **L'installation.** Un fichier unique par lequel passe tout appel à l'IA, la recette choisie par-dessus (page de conversation, ou fonction d'analyse), et un journal qui enregistre le coût réel de chaque appel.

## Ce que ça crée pour vous

- Un **point de passage unique** vers l'IA dans votre code : changer de modèle plus tard, c'est changer un mot
- Selon votre besoin : une **page de conversation** qui répond mot à mot, ou une **fonction d'analyse** qui rend un résultat exploitable
- Une **clé plafonnée** chez le fournisseur, installée dans votre projet et en ligne
- Un **journal des dépenses** : chaque appel enregistré avec son coût exact
- Une mise à jour de votre **politique de confidentialité**

## Prérequis

- Un projet Next.js (typiquement initialisé par `/bootstrap`)
- Un compte OpenRouter, gratuit à créer (Hypervibe vous guide) et à alimenter en crédits
- Une base de données pour le journal des coûts (`/add-db` si vous n'en avez pas)

## Astuces

{{callout:warning|Le plafond est votre vraie sécurité}}
L'IA se paie à l'usage : une boucle qui part de travers peut coûter cher en une nuit. C'est pourquoi la clé de votre projet porte une limite de dépense tenue par le fournisseur lui-même. Passé ce montant, les appels s'arrêtent et votre application le dit clairement, au lieu de continuer à facturer. Vous relevez le plafond quand vous le décidez.
{{/callout}}

{{callout:tip|Commencez en gamme Éco}}
Pour ranger, classer, extraire ou résumer, les modèles rapides font le travail pour quelques centimes par mois. La gamme supérieure se justifie quand la réponse est lue par un client et porte votre marque. Hypervibe vous montre les deux chiffres côte à côte : la différence est souvent d'un facteur vingt.
{{/callout}}

{{callout:warning|Les modèles gratuits et vos données}}
Des modèles gratuits existent et rendent de vrais services pour prototyper. Mais certains fournisseurs se réservent le droit d'apprendre sur ce qui passe. Dès que des données personnelles sont en jeu (messages de clients, CV, tout ce qui identifie quelqu'un), Hypervibe écarte le gratuit et route vers des fournisseurs qui s'engagent à ne pas s'entraîner sur vos contenus.
{{/callout}}

{{callout:info|IA en direct ou agent autonome}}
Cette commande installe une IA qui répond en quelques secondes, à l'intérieur de votre application. Si vous cherchez un processus qui tourne tout seul en arrière-plan, prend des décisions et utilise des outils, c'est `/add-agent`. Et si le traitement n'a besoin d'aucune intelligence, c'est `/add-automation`.
{{/callout}}
