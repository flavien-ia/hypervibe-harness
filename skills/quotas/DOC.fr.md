# /quotas

Affiche où en est votre consommation sur chaque service face aux plafonds des plans gratuits. Pratique pour anticiper un dépassement sans devoir ouvrir 6 dashboards séparés (Neon, Cloudflare, Brevo, Resend, Vercel).

## Quand l'utiliser

- Vous voulez **anticiper un dépassement** de quota et basculer sur un plan payant à temps
- Vous voulez **comprendre** où en sont vos forfaits gratuits (sans devoir ouvrir 6 dashboards séparés)
- Vous voulez vérifier après une montée en charge (par ex. un lancement de produit) qu'aucun service n'est en limite

## Comment ça se passe

1. **Lancement du script** : Hypervibe exécute en parallèle 6 fetchers qui interrogent les API de chaque service. Ça prend 2 à 5 secondes.

2. **Récupération des données** : pour chaque service, Hypervibe lit :
  - **Neon** : nombre de projets utilisés, storage utilisé (par projet, jusqu'à 0.5 Go chacun), heures de calcul utilisées (jusqu'à 100h / mois / projet)
  - **Cloudflare R2** : Go stockés, opérations lecture/écriture
  - **Cloudflare Workers** : requêtes / jour, slots cron utilisés sur les 5 gratuits
  - **Brevo** : emails envoyés / mois (jusqu'à 300/jour gratuits)
  - **Resend** : emails envoyés / mois (3 000 gratuits) + 100/jour
  - **Vercel** : bandwidth, fonctions, builds, hobby seats

3. **Affichage en tableau** : chaque métrique a :
  - **Utilisation** vs **plafond** (par ex. *"0.247 Go / 0.5 Go (49,5 %)"*)
  - **Verdict emoji** : ✅ (sous 70 %), ⚠️ (70-90 %), 🔴 (90 %+)
  - **Projection** quand applicable (par ex. *"Au rythme actuel, vous atteindrez le plafond dans 18 jours"*)

4. **Breakdown détaillé** : pour Neon (qui a des quotas **par projet**), Hypervibe affiche aussi le détail par projet, pour identifier exactement lequel consomme le plus.

5. **Conseils** : pour chaque verdict ⚠️ ou 🔴, Hypervibe propose des actions concrètes (alléger le projet, passer au plan supérieur, etc.).

## Ce que ça crée pour vous

- Un **rapport tableau** avec votre consommation actuelle sur les 6 services principaux
- Une vue **par projet** quand c'est pertinent (Neon notamment)
- Des **recommandations** pour anticiper un dépassement
- Aucune modification de vos comptes ou configurations, juste un rapport en lecture seule

## Prérequis

- Les services concernés doivent être connectés à votre ordi (via `/start` ou via les clés API user-scope)
- Vous pouvez lancer `/quotas` depuis n'importe quel dossier, c'est une vue **compte-wide**, pas projet-spécifique

## Astuces

{{callout:tip|Lancez tous les mois}}
Un coup d'œil régulier (chaque début de mois) vous évite la mauvaise surprise du dépassement. C'est particulièrement utile sur Neon (qui a des quotas par projet) et Resend (3 000 emails / mois passe vite si vous avez plusieurs apps).
{{/callout}}

{{callout:info|Plans gratuits = vraiment confortables}}
Pour la grande majorité des projets perso ou petit business, vous resterez bien en dessous des plafonds gratuits. Hypervibe le précise dans le rapport quand un service est *très* loin de la limite (par ex. *"vous utilisez 2 % de Cloudflare R2, vous êtes tranquille pour des années"*).
{{/callout}}

{{callout:warning|Neon = plafonds par projet}}
Particularité Neon : les 0.5 Go de storage et 100h de calcul sont **par projet**, pas par compte. Vous pouvez avoir 100 projets, donc 50 Go cumulés. Mais **chaque projet** ne doit pas dépasser 0.5 Go. Hypervibe affiche le breakdown par projet pour identifier celui qui est en train de saturer.
{{/callout}}
