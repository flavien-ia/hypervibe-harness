#!/usr/bin/env node
// Compte les Cron Triggers Cloudflare déjà utilisés sur le compte de l'user
// (limite Free : 5). Sortie JSON sur stdout :
//   { accountId, cfUsed, cfFree, perWorker: [{ workerId, schedules }] }
//
// Utilisé par /add-cron Step 4.c. Lit le token Cloudflare du coffre-fort (item CLOUDFLARE),
// avec fallback env var.
//
// Sortie en cas d'erreur : { error: "<message>" } + exit code 1.

import { readUserEnv } from "./_read-user-env.mjs";

// readUserEnv est vault-aware pour CLOUDFLARE_API_TOKEN (coffre → env → OS scope).
const TOKEN = process.env.CLOUDFLARE_API_TOKEN || readUserEnv("CLOUDFLARE_API_TOKEN") || readUserEnv("CF_API_TOKEN");
if (!TOKEN) {
  console.log(JSON.stringify({ error: "Token Cloudflare introuvable (coffre-fort `CLOUDFLARE` ni env var)" }));
  process.exit(1);
}

const HEADERS = { Authorization: `Bearer ${TOKEN}` };

async function cf(path) {
  const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, { headers: HEADERS });
  if (!r.ok) throw new Error(`HTTP ${r.status} sur ${path}`);
  const j = await r.json();
  if (!j.success) throw new Error(`API: ${JSON.stringify(j.errors)}`);
  return j.result;
}

try {
  const accounts = await cf("/accounts");
  const accountId = accounts?.[0]?.id;
  if (!accountId) throw new Error("aucun compte Cloudflare accessible avec ce token");

  const workers = await cf(`/accounts/${accountId}/workers/scripts`);
  const perWorker = [];
  let cfUsed = 0;

  for (const w of workers ?? []) {
    const result = await cf(`/accounts/${accountId}/workers/scripts/${w.id}/schedules`);
    const schedules = (result?.schedules ?? []).length;
    perWorker.push({ workerId: w.id, schedules });
    cfUsed += schedules;
  }

  console.log(JSON.stringify({ accountId, cfUsed, cfFree: Math.max(0, 5 - cfUsed), perWorker }));
} catch (err) {
  console.log(JSON.stringify({ error: err.message }));
  process.exit(1);
}
