# /add-domain

Connecte un **nom de domaine personnalisé** à votre app : `monsite.fr` au lieu de `monsite.vercel.app`.

## Quand l'utiliser

- Vous voulez que votre site soit accessible sur **votre propre adresse** (plus pro, mieux référencé, plus crédible)
- Vous venez d'acheter un domaine et vous voulez le connecter à votre projet
- Vous voulez aussi recevoir des emails sur votre domaine (`contact@monsite.fr`) sans créer une vraie boîte mail

## Comment ça se passe

L'architecture cible : **votre registrar → Cloudflare (DNS + Email Routing) → Vercel (hébergement)**. Cloudflare au milieu permet le DNS rapide, la protection DDoS gratuite, et le routage d'emails (recevoir sur `contact@monsite.fr` redirigé vers votre Gmail).

1. **Domaine acheté ou non ?** Si vous n'en avez pas encore, Hypervibe vous recommande Hostinger (UI/support FR, .fr pris en charge, automatisation facile). Vous achetez en quelques minutes.

2. **Identification du registrar** : chez qui le domaine est-il enregistré ? Hypervibe gère Hostinger, Cloudflare, OVH, Namecheap, GoDaddy (manuel pour ce dernier, leur API ne permet pas l'automation).

3. **Vérification Cloudflare** : Hypervibe vérifie que votre token Cloudflare est valide. Sinon, elle vous renvoie vers `/start`.

4. **Création de la zone Cloudflare** : Hypervibe ajoute votre domaine à votre compte Cloudflare et récupère les **2 nameservers** assignés.

5. **Changement des nameservers chez le registrar** : selon votre registrar, Hypervibe appelle directement son API (Hostinger, OVH, Namecheap, Gandi, Porkbun…) avec votre clé d'accès rangée dans votre coffre-fort, et pousse les nouveaux nameservers. Pour les registrars sans API publique (GoDaddy, IONOS…), vous le ferez à la main (instructions claires fournies).

6. **Configuration des DNS records** : Hypervibe supprime les anciens records et ajoute ceux de Vercel (`A` apex → 76.76.21.21, `CNAME` www → `cname.vercel-dns.com`).

7. **Connexion à Vercel** : Hypervibe ajoute le domaine côté Vercel (via `vercel domains add`).

8. **Mise à jour de l'URL dans le code** : `NEXT_PUBLIC_APP_URL` est mis à jour partout, et toutes les références à `*.vercel.app` dans le code (sitemap, metadata, JSON-LD, robots.txt, pages légales) sont remplacées par votre nouveau domaine, crucial pour le SEO.

9. **Email Routing (optionnel)** : Hypervibe vous propose de configurer la réception d'emails sur votre domaine. Si oui, elle délègue à `/new-email-address` pour créer une première adresse (par exemple `contact@monsite.fr` → votre Gmail).

10. **Resend (optionnel)** : si Resend est déjà configuré sur le projet, Hypervibe vous propose aussi de basculer l'envoi des emails sur votre nouveau domaine (`contact@monsite.fr` au lieu de `onboarding@resend.dev`).

11. **Commit + deploy** : les modifications de code sont commitées et poussées pour redéployer.

## Ce que ça crée pour vous

- Une **zone Cloudflare** pour votre domaine, avec les nameservers du registrar pointant dessus
- Les **records DNS Vercel** (A apex + CNAME www) configurés dans Cloudflare
- Le domaine **ajouté à votre projet Vercel** avec certificat HTTPS automatique
- La variable `NEXT_PUBLIC_APP_URL` mise à jour partout (Vercel + `.env` + code source)
- Si vous le voulez : la **réception d'emails** sur votre domaine (via Email Routing Cloudflare)
- Si vous le voulez : **l'envoi d'emails** Resend depuis votre domaine

## Prérequis

- Un projet Next.js déployé sur Vercel (typiquement par `/bootstrap`)
- Cloudflare connecté à votre ordi (`/start` s'en occupe)
- Un nom de domaine (acheté maintenant ou déjà existant)

## Astuces

{{callout:tip|Propagation DNS = entre 5 min et 24h}}
Après le changement des nameservers, le DNS peut mettre **5 à 30 minutes** (et rarement jusqu'à 24h) pour se propager partout dans le monde. Ne paniquez pas si votre site n'est pas immédiatement accessible, patience. Ça arrive. Le certificat HTTPS est posé automatiquement par Vercel dès que le DNS est en place.
{{/callout}}

{{callout:warning|N'oubliez pas vos OAuth après changement de domaine}}
Si vous avez déjà configuré Google ou GitHub OAuth, vous devez **ajouter** la nouvelle URL de callback (`https://votre-domaine/api/auth/callback/google` ou `/github`) dans les consoles correspondantes. Sinon le login plante en prod avec `redirect_uri_mismatch`. Hypervibe vous le rappelle à la fin du processus.
{{/callout}}

{{callout:info|Email Routing = gratuit, illimité, sans vraie boîte}}
Cloudflare Email Routing permet de recevoir des emails sur `contact@monsite.fr` (ou `support@`, `hello@`, etc.) et de les rediriger vers une boîte existante (Gmail, Outlook, etc.). C'est **gratuit, illimité**, et pas besoin de créer une vraie boîte mail. Vous répondez juste depuis votre boîte habituelle.
{{/callout}}
