#!/usr/bin/env node
// test-template-guards.mjs - Ce que les gabarits laissent passer d'une adresse venue d'ailleurs.
//
// Trois défauts de la même famille, corrigés en 3.3.11, tenus ici :
//   - une adresse de retour lue dans l'URL (`callbackUrl`) partait telle quelle dans le routeur
//     après la connexion : `javascript:...` y est exécuté, `//hote` mène ailleurs ;
//   - le lien d'une notification (cloche, notification système) était suivi tel quel ;
//   - l'adresse d'un abonnement aux notifications, déclarée par le navigateur donc par
//     l'utilisateur, était acceptée quelle qu'elle soit, et le serveur y écrivait ensuite.
// Et un quatrième, d'une autre famille : la commande Stripe qui liste les profils affichait la
// clé de test en clair quand une skill la lançait sans filtre.
//
// Les règles sont LUES dans les gabarits (le filtre tel qu'il est écrit, la liste telle qu'elle
// est écrite), puis jouées sur des adresses. Aucun réseau, aucun compte.
//
//   node scripts/tests/test-template-guards.mjs

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lire = (rel) => readFileSync(join(ROOT, rel), "utf8");

let checks = 0;
let failures = 0;
function check(label, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${ok || !detail ? "" : `   (${String(detail).slice(0, 500)})`}`);
}

// ── 1. Un chemin interne, et rien d'autre ──
const INTERNES = ["/", "/admin", "/admin/commandes?page=2", "/a/b#c"];
const AILLEURS = [
  "https://exemple.invalid/",
  "http://exemple.invalid",
  "//exemple.invalid",
  "/\\exemple.invalid",
  "javascript:alert(1)",
  "JaVaScRiPt:alert(1)",
  "data:text/html,x",
  "exemple.invalid",
  " /admin",
  "",
];

/** Le filtre tel qu'un gabarit l'écrit : `/^...$/.test(nom)`, lu puis compilé. */
function filtreDe(source, nom) {
  const i = source.indexOf(`.test(${nom})`);
  if (i < 0) return null;
  const debut = source.lastIndexOf("/^", i);
  const fin = source.lastIndexOf("/", i);
  if (debut < 0 || fin <= debut) return null;
  try {
    return new RegExp(source.slice(debut + 1, fin));
  } catch {
    return null;
  }
}

const GABARITS = [
  ["templates/auth/admin/pages/signin.tsx", "rawCallback", "la connexion de l'admin"],
  ["templates/2fa/signin-page.tsx", "rawCallback", "la connexion à deux facteurs"],
  ["templates/auth-signin/plain.tsx", "rawCallback", "la connexion des membres"],
  ["templates/notif-center/notification-bell.tsx", "n.url", "la cloche"],
  ["templates/push/sw-push-handlers.ts", "raw", "le clic sur une notification système"],
];
for (const [fichier, nom, quoi] of GABARITS) {
  if (!existsSync(join(ROOT, fichier))) {
    check(`${quoi} : le gabarit existe (${fichier})`, false);
    continue;
  }
  const filtre = filtreDe(lire(fichier), nom);
  check(`${quoi} : l'adresse passe par un filtre lisible`, filtre !== null, fichier);
  if (!filtre) continue;
  const acceptes = AILLEURS.filter((a) => filtre.test(a));
  const refuses = INTERNES.filter((a) => !filtre.test(a));
  check(`${quoi} : aucune adresse d'ailleurs ne passe (autre site, //hote, javascript:)`, acceptes.length === 0, JSON.stringify(acceptes));
  check(`${quoi} : un chemin interne passe`, refuses.length === 0, JSON.stringify(refuses));
}
for (const fichier of ["templates/auth/admin/pages/signin.tsx", "templates/2fa/signin-page.tsx"]) {
  const src = lire(fichier);
  check(`${fichier} : l'adresse lue dans l'URL n'est jamais suivie telle quelle`, !/callbackUrl\s*=\s*params\.get\("callbackUrl"\)\s*(\?\?|\|\|)/.test(src) && /rawCallback && \/\^/.test(src));
}
check("la cloche ne suit le lien que s'il passe le filtre", /if \(n\.url && \/\^[^\n]+\.test\(n\.url\)\) window\.location\.assign\(n\.url\)/.test(lire("templates/notif-center/notification-bell.tsx")));

// ── 2. L'adresse d'un abonnement : un service de notification connu ──
{
  const src = lire("templates/push/server-push.ts");
  const liste = /const PUSH_SERVICE_HOSTS = \[([\s\S]*?)\];/.exec(src);
  const hotes = liste ? [...liste[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [];
  check("la liste des services est lisible dans le gabarit", hotes.length >= 4, src.slice(0, 200));
  // La règle écrite dans le gabarit, rejouée ici sur la liste lue.
  const regle = /url\.protocol !== "https:" \|\| url\.port \|\| url\.username \|\| url\.password/.test(src) && /host === known \|\| host\.endsWith\(`\.\$\{known\}`\)/.test(src);
  check("la règle : https, sans port ni identifiants, l'hôte ou l'un de ses sous-domaines", regle);
  const accepte = (endpoint) => {
    try {
      const url = new URL(endpoint);
      if (url.protocol !== "https:" || url.port || url.username || url.password) return false;
      const host = url.hostname.toLowerCase();
      return hotes.some((known) => host === known || host.endsWith(`.${known}`));
    } catch {
      return false;
    }
  };
  const VRAIS = [
    "https://fcm.googleapis.com/fcm/send/abc:def",
    "https://jmt17.google.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/QabcDEF",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
  ];
  const FAUX = [
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://fcm.googleapis.com:8443/fcm/send/abc",
    "https://user:pass@fcm.googleapis.com/fcm/send/abc",
    "https://fcm.googleapis.com.exemple.invalid/fcm/send/abc",
    "https://exemple.invalid/fcm.googleapis.com",
    "https://notify.windows.com.exemple.invalid/w/",
    "https://faux-notify.windows.com.exemple.invalid/",
    "https://169.254.169.254/latest/meta-data/",
    "https://localhost/",
    "http://127.0.0.1:3000/api",
    "pas une adresse",
  ];
  check("les adresses des navigateurs passent (Chrome, Chrome en préversion, Firefox, Safari, Edge)", VRAIS.every(accepte), JSON.stringify(VRAIS.filter((v) => !accepte(v))));
  check("rien d'autre ne passe (http, un port, des identifiants, un hôte qui imite, une adresse interne)", !FAUX.some(accepte), JSON.stringify(FAUX.filter(accepte)));
  const routeur = lire("templates/push/push-router.ts");
  check("l'inscription refuse une adresse qui n'est pas celle d'un service", /\.refine\(isPushServiceEndpoint,/.test(routeur) && /import \{ isPushServiceEndpoint \} from "~\/server\/push"/.test(routeur));
  check("l'envoi saute une adresse enregistrée avant la liste", /if \(!isPushServiceEndpoint\(s\.endpoint\)\) continue;/.test(src));
  const securite = lire("skills/security/SKILL.md");
  check("/security nomme les mêmes services que le gabarit", hotes.every((h) => securite.includes(`\`${h}\``)), hotes.filter((h) => !securite.includes(`\`${h}\``)).join(", "));
}

// ── 3. Stripe : le gabarit et les commandes ──
{
  const gabarit = lire("scripts/setup-stripe.mjs");
  check("le gabarit de paiement ne passe plus payment_method_types (retiré des types en stripe 23)", !/^\s*payment_method_types\s*:/m.test(gabarit));
  const skill = lire("skills/add-stripe/SKILL.md");
  check("/add-stripe installe stripe épinglé sur sa version majeure", /pnpm add stripe@\^23\b/.test(skill) && !/pnpm add stripe(\s|`|$)/m.test(skill));

  // `stripe config --list` écrit la clé de test en clair : aucune skill ne le lance sans filtre.
  const nus = [];
  const skillsDir = join(ROOT, "skills");
  for (const nom of readdirSync(skillsDir)) {
    const f = join(skillsDir, nom, "SKILL.md");
    if (!existsSync(f)) continue;
    readFileSync(f, "utf8")
      .split(/\r?\n/)
      .forEach((ligne, i) => {
        if (!/stripe config --list/.test(ligne)) return;
        // Une commande à lancer (pas une phrase qui la nomme pour l'interdire) : elle est filtrée.
        const commande = /^\s*(stripe config --list|[A-Z_]+=\$\(stripe config --list)/.test(ligne) || /^\s*```/.test(ligne);
        const filtree = /stripe config --list[^|\n]*\|\s*grep -E/.test(ligne);
        if (commande && !filtree) nus.push(`${nom}:${i + 1}`);
      });
  }
  check("aucune skill ne lance `stripe config --list` sans filtrer ce qu'il affiche", nus.length === 0, nus.join(", "));
  check("/add-stripe ne lit du profil que le nom du compte et son identifiant", /stripe config --list 2>\/dev\/null \| grep -E '[^']*display_name\|account_id/.test(skill));
  const commandes = skill.split(/\r?\n/).filter((l) => /^\s*stripe (listen|trigger|products|prices|webhook_endpoints)\b/.test(l));
  const sansProfil = commandes.filter((l) => !l.includes("<STRIPE_PROFILE>"));
  check("chaque commande Stripe de /add-stripe porte le profil du projet", commandes.length >= 3 && sansProfil.length === 0, sansProfil.join(" | "));
}

console.log(`\n${checks - failures}/${checks} verifications`);
process.exitCode = failures ? 1 : 0;
