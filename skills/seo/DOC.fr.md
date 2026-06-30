# /seo

Audite et améliore le référencement Google de votre site. Hypervibe scanne tout ce qui compte pour Google (contenu, technique, performance, accessibilité), vous explique chaque problème en langage simple et corrige ce qu'elle peut.

## Quand l'utiliser

- **Avant ou peu après** la mise en production de votre site
- Vous voulez **être trouvé sur Google** quand quelqu'un cherche votre nom, votre marque, ou les mots-clés de votre activité
- Vous voulez vérifier que vos partages sur LinkedIn / Facebook / WhatsApp affichent une **jolie carte** (Open Graph)
- Vous voulez améliorer votre **score Core Web Vitals** (vitesse perçue par Google)

## Comment ça se passe

1. **Audit complet** : Hypervibe scan votre projet selon plusieurs axes :
  - **Technique** : metadata `<title>` + `<description>` sur chaque page, `metadataBase`, sitemap, robots.txt, canonical URLs, JSON-LD, hreflang si i18n, image OG
  - **Contenu** : mots-clés pertinents, structure des titres (H1 / H2 / H3), longueur des textes, fraîcheur du contenu
  - **Performance** : taille des images, lazy loading, polices, JavaScript bloquant, Core Web Vitals (LCP, FID, CLS)
  - **Accessibilité** : alt sur les images, contraste des couleurs, navigation au clavier, labels sur les formulaires
  - **URLs** : kebab-case, longueur, présence du mot-clé principal
  - **Lisibilité** : ton clair, phrases courtes, structure (introduction / paragraphes / conclusion)

2. **Rapport pédagogique** : chaque axe est noté ✅ OK / ⚠️ À améliorer / 🔴 À corriger. Pour chaque problème :
  - **Explication en langage simple** (par ex. "il manque le grand titre principal sur ta page Contact, la balise `<h1>`")
  - **Conséquence concrète** (par ex. "Google ne comprend pas clairement de quoi parle cette page, et elle a moins de chances d'apparaître quand quelqu'un cherche 'contact Mon Entreprise'")
  - **Correction proposée** avec le **pourquoi**

3. **Corrections automatiques** : Hypervibe corrige ce qu'elle peut sans risque (ajout de metadata, optimisation des images, fix de l'arborescence des titres, etc.). Pour les changements qui touchent au contenu (réécrire un texte, choisir un mot-clé principal), elle vous propose et vous décidez.

## Ce que ça crée pour vous

- Un **rapport SEO complet** avec verdicts par axe + explications en langage simple
- Des **corrections appliquées** automatiquement sur les éléments techniques
- Des **suggestions de contenu** que vous validez avant application
- Pas de modifications côté Google directement (ça, c'est `/gsc` qui gère)

## Prérequis

- Aucun prérequis particulier, `/seo` peut tourner sur n'importe quel projet du plugin
- Mieux vaut être déjà déployé sur Vercel pour que les audits Lighthouse / Core Web Vitals soient pertinents

## Astuces

{{callout:tip|Lancez juste après une grosse refonte}}
À chaque fois que vous changez beaucoup de pages d'un coup (refonte de la home, ajout d'un blog, traduction multilingue), relancez `/seo` derrière pour vérifier que les fondamentaux restent en place. C'est facile de casser un meta-tag en refactorisant.
{{/callout}}

{{callout:info|/seo + /geo + /gsc = le combo complet}}
- **`/seo`** = audit interne (ce que Google **pourrait** voir sur votre site)
- **`/geo`** = optimiser pour être cité par les IA (ChatGPT, Claude, Perplexity)
- **`/gsc`** = lire les données réelles Google (ce qu'il **voit vraiment** : impressions, clics, requêtes)

Lancez les trois dans cet ordre pour la couverture complète.
{{/callout}}

{{callout:warning|Le SEO prend du temps}}
Une optimisation SEO ne se traduit pas en clics du jour au lendemain. Google recrawle votre site (re-visite et ré-évalue) sur quelques semaines après vos changements. Soyez patient et mesurez les progrès dans Google Search Console (`/gsc`) plusieurs mois plus tard, pas le lendemain.
{{/callout}}
