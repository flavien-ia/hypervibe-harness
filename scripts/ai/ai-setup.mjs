#!/usr/bin/env node
/**
 * Outil en ligne de commande de la skill `/add-ai`.
 *
 *   node ai-setup.mjs modeles --gamme eco
 *   node ai-setup.mjs estimer --gamme eco --profil chat --par-jour 50
 *   node ai-setup.mjs cle --nom mon-projet --plafond 10 [--reset-quotidien]
 *   node ai-setup.mjs cles
 *
 * Sort du JSON sur stdout (la skill le lit), et rien d'autre : les messages
 * destinés à l'humain passent par la skill, pas par ce script.
 *
 * Codes de sortie : 0 succès, 1 erreur d'usage, 2 coffre verrouillé,
 * 3 catalogue ou API OpenRouter injoignable.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  candidats,
  creerCleProjet,
  GAMMES,
  listerCles,
  PROFILS,
  tableauEstimation,
} from "./openrouter.mjs";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const VAULT = path.join(ICI, "..", "vault", "vault.mjs");

const args = process.argv.slice(2);
const commande = args[0];

function opt(nom, defaut = null) {
  const i = args.indexOf(`--${nom}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--")
    ? args[i + 1]
    : defaut;
}
const drapeau = (nom) => args.includes(`--${nom}`);

/**
 * Toute clé ressemblant à un secret OpenRouter, où qu'elle se trouve dans ce
 * qu'on s'apprête à écrire.
 *
 * Ce filet existe parce qu'il a servi : une clé fraîchement créée s'est
 * retrouvée affichée dans une conversation, parce qu'un appelant a planté et
 * que Node a vidé l'objet d'erreur complet, stdout compris. Un secret ne doit
 * pas dépendre du fait que personne ne se trompe en aval.
 */
const MASQUE = /sk-or-v1-[A-Za-z0-9]{8,}/g;

const sortir = (objet, code = 0) => {
  const texte = JSON.stringify(objet, null, 2).replace(
    MASQUE,
    "sk-or-v1-<masquee>",
  );
  process.stdout.write(texte + "\n");
  process.exit(code);
};

/**
 * La clé de management, lue dans le coffre. C'est une clé GLOBALE, partagée
 * entre projets : elle n'a rien à faire dans un `.env`, et l'utilisateur n'a
 * jamais à la manipuler après l'avoir déposée une fois.
 */
function cleGestion() {
  try {
    return execFileSync("node", [VAULT, "get", "OPENROUTER", "management_key"], {
      encoding: "utf8",
    }).trim();
  } catch (e) {
    const code = e.status;
    if (code === 2 || code === 3) {
      sortir(
        {
          ok: false,
          raison: "coffre-verrouille",
          message:
            "Le coffre est verrouillé ou expiré : ouvrez-le puis relancez (voir _ensure-vault).",
        },
        2,
      );
    }
    sortir(
      {
        ok: false,
        raison: "cle-absente",
        message:
          "Aucune clé de management OpenRouter dans le coffre (item OPENROUTER, champ management_key).",
      },
      2,
    );
  }
}

async function principal() {
  switch (commande) {
    case "modeles": {
      const gamme = opt("gamme", "eco");
      if (!GAMMES[gamme]) {
        sortir({ ok: false, message: `Gamme inconnue : ${gamme}` }, 1);
      }
      const liste = await candidats(gamme, {
        limite: Number(opt("limite", "6")),
      });
      sortir({
        ok: true,
        gamme,
        libelle: GAMMES[gamme].libelle,
        usage: GAMMES[gamme].usage,
        modeles: liste,
      });
      break;
    }

    case "estimer": {
      const gamme = opt("gamme", "eco");
      const profil = opt("profil", "chat");
      const parJour = Number(opt("par-jour", "50"));
      if (!PROFILS[profil]) {
        sortir(
          {
            ok: false,
            message: `Profil inconnu : ${profil}. Attendus : ${Object.keys(PROFILS).join(", ")}`,
          },
          1,
        );
      }
      const tableau = await tableauEstimation({
        gamme,
        profil,
        appelsParJour: parJour,
      });
      // Le plafond suggéré arrondit au-dessus du coût mensuel estimé : il doit
      // laisser respirer un mois normal, et couper un mois anormal.
      const pire = Math.max(0, ...tableau.lignes.map((l) => l.parMoisNum));
      const plafondSuggere = Math.max(5, Math.ceil((pire * 2) / 5) * 5);
      sortir({ ok: true, ...tableau, plafondSuggere });
      break;
    }

    case "cle": {
      const nom = opt("nom");
      const plafond = Number(opt("plafond", "0"));
      if (!nom || !(plafond > 0)) {
        sortir(
          {
            ok: false,
            message:
              "Usage : cle --nom <projet> --plafond <dollars> [--reset-quotidien]",
          },
          1,
        );
      }
      // Le prefixe situe la cle parmi les autres du compte, mais un projet qui
      // s'appelle deja « hypervibe » n'a pas besoin de s'appeler deux fois.
      const etiquette = nom.startsWith("hypervibe") ? nom : `hypervibe-${nom}`;
      const creee = await creerCleProjet({
        cleGestion: cleGestion(),
        nom: etiquette,
        plafondUsd: plafond,
        resetQuotidien: drapeau("reset-quotidien"),
      });

      // La valeur ne SORT PAS de ce processus : le script la pose lui-même
      // dans le .env du projet et sur Vercel, puis ne rend que de quoi en
      // parler. Aucun appelant n'a besoin de la voir, donc aucun appelant ne
      // peut la divulguer, y compris en plantant.
      const projet = opt("projet", process.cwd());
      const pousse = spawnSync(
        "node",
        [
          path.join(ICI, "..", "push-env-vars.mjs"),
          `OPENROUTER_API_KEY=${creee.valeur}`,
        ],
        { encoding: "utf8", cwd: projet },
      );
      const journal = (pousse.stdout ?? "")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.includes(creee.valeur));

      sortir({
        ok: pousse.status === 0,
        hash: creee.hash,
        plafondUsd: creee.plafondUsd,
        nom: etiquette,
        installeeDans: projet,
        journal,
        ...(pousse.status === 0
          ? {}
          : {
              message:
                "La clé est créée mais n'a pas pu être écrite dans le projet. Elle est visible sur openrouter.ai/settings/keys : révoquez-la et relancez plutôt que de la récupérer à la main.",
            }),
      });
      break;
    }

    case "cles": {
      const liste = await listerCles(cleGestion());
      sortir({
        ok: true,
        cles: liste.map((k) => ({
          nom: k.name,
          hash: k.hash,
          plafond: k.limit,
          restant: k.limit_remaining,
          desactivee: k.disabled ?? false,
        })),
      });
      break;
    }

    default:
      sortir(
        {
          ok: false,
          message:
            "Commandes : modeles | estimer | cle | cles (voir l'en-tête du script).",
        },
        1,
      );
  }
}

principal().catch((e) => {
  sortir({ ok: false, message: e.message }, 3);
});
