// _keep-rules.mjs - The accounts a person shares between their projects, which /delete-project
// must never offer to delete (an API key used by ten projects dies with the first deletion).
//
// They belong to the person, not to the plugin: the list lives on their machine, in
// ~/.hypervibe/delete-project-keep.json, never in the plugin (which is open source, and whose
// users do not share one person's accounts). Until September 2026 one person's own accounts
// were written into templates/delete-project/third-party-services.json and shipped to everyone.
//
//   {
//     "keep": [
//       { "pattern": "^MYSERVICE_", "label": "MyService (personal account, shared by my projects)" }
//     ]
//   }
//
// Each rule becomes an entry of third-party-services.json that says "keep", placed FIRST so the
// person's choice wins over the generic entry of the same service.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const KEEP_FILE = join(homedir(), ".hypervibe", "delete-project-keep.json");

/** The person's keep rules, shaped like third-party-services.json entries; [] without a usable file. */
export function keepRules(file = KEEP_FILE) {
  if (!existsSync(file)) return [];
  let data;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  const rules = [];
  for (const rule of Array.isArray(data?.keep) ? data.keep : []) {
    if (typeof rule?.pattern !== "string" || !rule.pattern) continue;
    try {
      new RegExp(rule.pattern);
    } catch {
      continue; // an unreadable pattern keeps nothing rather than everything
    }
    rules.push({
      pattern: rule.pattern,
      service: "Compte à garder",
      label: typeof rule.label === "string" && rule.label ? rule.label : "Compte partagé entre projets, à NE PAS supprimer",
      actionUrl: null,
      instructions:
        "Ce compte sert à plusieurs projets, la personne l'a déclaré sur ce poste. Ne PAS supprimer la clé ni le compte : le projet supprimé arrête juste de s'en servir.",
    });
  }
  return rules;
}
