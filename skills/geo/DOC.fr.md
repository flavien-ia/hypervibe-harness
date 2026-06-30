# /geo

Optimise votre site pour être **cité par les IA** (ChatGPT, Claude, Perplexity, Google AI Overviews, Bing Chat). Complémentaire à `/seo`, un site bien classé sur Google n'est pas forcément bien cité par les IA, et vice versa.

## Quand l'utiliser

- Votre site a un **contenu informatif** (articles, FAQ, tutoriels, documentation, blog) que les IA pourraient citer en réponse aux questions de leurs utilisateurs
- Vous voulez **devenir une source de référence** pour les requêtes IA dans votre domaine
- Vous avez déjà lancé `/seo` et vous voulez compléter pour le canal "IA"

## Comment ça se passe

1. **Préflight SEO** : Hypervibe vérifie d'abord que les fondations SEO classiques sont en place (metadata, sitemap, robots.txt, JSON-LD WebSite, structure HTML sémantique). Une page que Google ne peut pas indexer correctement ne sera pas non plus bien vue par les IA. Si quelque chose manque, Hypervibe vous suggère `/seo` d'abord.

2. **Audit GEO complet** :
  - **`llms.txt`** : un fichier à la racine de votre site (comme robots.txt, mais spécifique aux IA) qui indique aux moteurs IA ce qu'ils peuvent utiliser et comment
  - **Politique des crawlers IA** : vérifie le `robots.txt` pour les User-Agents IA (GPTBot, ClaudeBot, Perplexity, etc.). Vous pouvez les autoriser, restreindre, bloquer selon votre stratégie.
  - **FAQPage schema** : pour vos pages de questions/réponses, ajout des données structurées `FAQPage` que les IA repèrent facilement
  - **Format Q&A et chunking** : Hypervibe vérifie que votre contenu est découpé en blocs auto-suffisants (questions claires, paragraphes courts, sous-titres explicites)
  - **Signaux de citabilité** : dates précises (publication, mise à jour), chiffres/stats avec source, auteurs nommés, liens vers les sources externes
  - **Signaux E-E-A-T** : Experience, Expertise, Authoritativeness, Trustworthiness, les 4 critères que les IA évaluent pour décider si votre contenu est fiable

3. **Soumission IndexNow (optionnel)** : Hypervibe vous propose de configurer IndexNow, un protocole qui notifie Bing et Yandex (et indirectement ChatGPT qui s'appuie sur Bing) à chaque nouvelle publication.

4. **Rapport pédagogique** : chaque trouvaille est expliquée en langage simple, avec la **conséquence concrète** (par ex. "ta page de FAQ n'a pas le marquage FAQPage. Conséquence : quand quelqu'un demande à ChatGPT 'comment faire X', ton contenu est moins susceptible d'être cité comme source").

5. **Corrections proposées et appliquées** : Hypervibe ajoute le `llms.txt`, configure les schemas FAQPage, met à jour le robots.txt pour les crawlers IA, et propose les améliorations de contenu (que vous validez).

## Ce que ça crée pour vous

- Un fichier **`llms.txt`** à la racine de votre site
- Des entrées dans **robots.txt** pour les crawlers IA selon votre stratégie
- Des **schemas FAQPage** sur vos pages de Q&A
- Si vous le voulez : configuration **IndexNow** (Bing/Yandex)
- Des suggestions de réécriture pour améliorer la citabilité (chiffres, dates, sources)
- Un rapport complet avec verdicts par axe

## Prérequis

- Le SEO de base doit être en place (`/seo` en amont si nécessaire)
- Votre site doit avoir du **contenu informatif** : un simple site vitrine sans contenu n'a pas vraiment matière à être cité par les IA

## Astuces

{{callout:tip|GEO = un nouveau canal de visibilité}}
Le SEO classique vous fait apparaître dans les résultats Google (liste bleue). Le GEO vise à **être cité par les IA dans leurs réponses**. Les deux ne sont pas identiques, un site qui sort en première page Google peut quand même ne pas être cité par ChatGPT (et vice versa). Plus la part des recherches passe par les IA, plus le GEO compte.
{{/callout}}

{{callout:info|llms.txt = un standard émergent}}
Le fichier `llms.txt` n'est pas (encore) un standard officiel, mais il est **adopté par Anthropic, OpenAI, et plusieurs autres acteurs**. Il vous permet de dire aux IA "voilà mon contenu en clair, voilà comment l'utiliser". Pour vous, c'est zéro coût (Hypervibe le génère), et c'est aligné avec la direction que prennent les standards.
{{/callout}}

{{callout:warning|Citabilité = chiffres + dates + sources}}
Pour qu'une IA vous cite, elle doit **avoir confiance** dans votre contenu. Les signaux clés : chiffres précis (pas "beaucoup d'utilisateurs" mais "12 % des utilisateurs"), dates explicites (pas "récemment" mais "en mars 2026"), et liens vers les sources externes que vous citez. Hypervibe peut suggérer ces enrichissements page par page.
{{/callout}}
