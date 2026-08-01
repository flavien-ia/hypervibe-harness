// i18n.mjs - User-facing strings for the interactive vault window.
//
// The window is a SEPARATE process: it cannot see the conversation, so it has no
// way to know which language the user speaks. The calling skill does know, and
// passes it with `--lang fr`. When the flag is absent we fall back to the OS
// locale, then to English. Never guess from anything else.
//
// Only the WINDOW is translated here. Scripts whose output is read by Claude
// rather than by the user (push-env-vars, vault.mjs...) deliberately stay in
// English: that output is diagnostics, not user interface.
//
// Adding a language: copy the `en` block, translate the values, keep the {braces}
// placeholders. Any key missing from a language silently falls back to English,
// so a partial translation is safe to ship.

const STRINGS = {
  en: {
    pressEnter: "\nPress Enter to close...",
    installing: "Vault tool not found, running automatic installation...\n",
    bwMissing: "The vault tool was not found and automatic installation failed. Check your connection, or install it manually: https://bitwarden.com/help/cli/",
    bwCannotRun: "Cannot run the vault tool. Set up the vault again to reinstall it.",

    email: "Email: ",
    emailRequired: "An email address is required.",
    masterPassword: "Master password: ",
    alreadyLoggedIn: "Already signed in as {email} on {server}.",
    signingIn: "Signing in...",
    twoFactorIntro: "If two-factor authentication (2FA) is enabled on your account, a CODE will be requested right after.",
    twoFactorWhere: "  - Depending on your setup, this code arrives either in your authenticator app (Google Authenticator, etc.),",
    twoFactorMail: "    or by EMAIL (check your inbox, the message arrives at sign-in time).",
    twoFactorType: "  - Type the code into this window, then Enter.",
    signInFailed: "Sign-in failed (wrong password or 2FA code?). Run it again to retry.",
    signedIn: "\nSigned in. Next step: unlock.",

    notSignedIn: "No account is signed in on this machine. Sign in first, before unlocking.",
    unlocking: "Unlocking the vault for {email}...",
    unlockFailed: "Unlock failed (wrong password?).",
    unlocked: "Vault unlocked. Valid for 12h.",

    vaultLocked: "Vault locked or session expired. Unlock it first.",
    itemName: "Item name (e.g. CLOUDFLARE): ",
    nameRequired: "A name is required.",
    serviceOptional: "Service (optional): ",
    fieldsPrompt: "Fields (name:type,... ; default value:secret): ",
    badFieldType: "Unknown field type: {type}",
    folderFailed: "Cannot find or create the folder '{folder}' in the vault.",
    storingItem: "\nStoring '{name}' in folder '{folder}'{service}\n",
    serviceSuffix: " (service: {service})",
    hiddenPrompt: "{name} (hidden): ",
    plainPrompt: "{name}: ",
    emptyValue: "No value entered for '{name}'.",
    saveFailed: "Could not save '{name}'.",
    savedCreated: "'{name}' created.",
    savedUpdated: "'{name}' updated.",

    keysRequired: "--keys is required (e.g. --keys \"STRIPE_SECRET_KEY:secret\").",
    projectDirRequired: "--project-dir is required.",
    projectNotFound: "Project folder not found: {dir}",
    emptyKeyName: "Empty key name in --keys.",
    openingUrl: "\nOpening {url} in your browser.",
    grabValue: "Grab the value there, then come back to THIS window.\n",
    collectIntro: "Storing {count} value(s) for the project at {dir}.",
    collectWhere: "Typed here, they go straight into the project's .env (and Vercel).",
    collectNeverChat: "They never pass through our conversation.\n",
    collectFailed: "Saving failed. Details:\n{detail}",
    collectSavedLocal: "\nSaved to the project's .env: {names}.",
    collectSavedVercel: "\nSaved to the project's .env and pushed to Vercel: {names}.",

    willOpen: "[vault] A terminal window will open for the \"{cmd}\" step.",
    ifNothingOpens: "[vault] If nothing opens, run this by hand in a terminal:\n           {cmd}",
    osascriptFailed: "[vault] Could not open Terminal{detail}.",
    osascriptFix: "[vault] Allow Terminal in System Settings -> Privacy & Security -> Automation, then try again, or run the command above by hand.",
    noEmulator: "[vault] No terminal window could be opened. Run this by hand: {cmd}",
    windowTimeout: "[vault] Gave up waiting for the terminal window.",
  },

  fr: {
    pressEnter: "\nAppuie sur Entree pour fermer...",
    installing: "Outil de coffre introuvable, installation automatique en cours...\n",
    bwMissing: "L'outil de coffre est introuvable et l'installation automatique a echoue. Verifie ta connexion, ou installe-le manuellement : https://bitwarden.com/help/cli/",
    bwCannotRun: "Impossible de lancer l'outil de coffre. Relance la configuration du coffre pour le reinstaller.",

    email: "Email : ",
    emailRequired: "Une adresse email est necessaire.",
    masterPassword: "Mot de passe maitre : ",
    alreadyLoggedIn: "Deja connecte en tant que {email} sur {server}.",
    signingIn: "Connexion en cours...",
    twoFactorIntro: "Si la double authentification (2FA) est active sur ton compte, un CODE va etre demande juste apres.",
    twoFactorWhere: "  - Selon ta configuration, ce code arrive soit dans ton application d'authentification (Google Authenticator, etc.),",
    twoFactorMail: "    soit par EMAIL (regarde ta boite, le message arrive au moment de la connexion).",
    twoFactorType: "  - Saisis le code dans cette fenetre, puis Entree.",
    signInFailed: "Echec de la connexion (mauvais mot de passe ou mauvais code 2FA ?). Relance pour reessayer.",
    signedIn: "\nConnecte. Etape suivante : le deverrouillage.",

    notSignedIn: "Aucun compte n'est connecte sur cette machine. Connecte-toi d'abord, avant de deverrouiller.",
    unlocking: "Deverrouillage du coffre pour {email}...",
    unlockFailed: "Echec du deverrouillage (mauvais mot de passe ?).",
    unlocked: "Coffre deverrouille. Valable 12h.",

    vaultLocked: "Coffre verrouille ou session expiree. Deverrouille-le d'abord.",
    itemName: "Nom de l'element (ex : CLOUDFLARE) : ",
    nameRequired: "Un nom est necessaire.",
    serviceOptional: "Service (facultatif) : ",
    fieldsPrompt: "Champs (nom:type,... ; par defaut value:secret) : ",
    badFieldType: "Type de champ inconnu : {type}",
    folderFailed: "Impossible de trouver ou de creer le dossier '{folder}' dans le coffre.",
    storingItem: "\nEnregistrement de '{name}' dans le dossier '{folder}'{service}\n",
    serviceSuffix: " (service : {service})",
    hiddenPrompt: "{name} (masque) : ",
    plainPrompt: "{name} : ",
    emptyValue: "Aucune valeur saisie pour '{name}'.",
    saveFailed: "Impossible d'enregistrer '{name}'.",
    savedCreated: "'{name}' cree.",
    savedUpdated: "'{name}' mis a jour.",

    keysRequired: "--keys est obligatoire (ex : --keys \"STRIPE_SECRET_KEY:secret\").",
    projectDirRequired: "--project-dir est obligatoire.",
    projectNotFound: "Dossier de projet introuvable : {dir}",
    emptyKeyName: "Nom de cle vide dans --keys.",
    openingUrl: "\nOuverture de {url} dans ton navigateur.",
    grabValue: "Recupere la valeur la-bas, puis reviens dans CETTE fenetre.\n",
    collectIntro: "Enregistrement de {count} valeur(s) pour le projet situe dans {dir}.",
    collectWhere: "Saisies ici, elles vont directement dans le .env du projet (et sur Vercel).",
    collectNeverChat: "Elles ne passent jamais par notre conversation.\n",
    collectFailed: "L'enregistrement a echoue. Details :\n{detail}",
    collectSavedLocal: "\nEnregistre dans le .env du projet : {names}.",
    collectSavedVercel: "\nEnregistre dans le .env du projet et pousse sur Vercel : {names}.",

    willOpen: "[coffre] Une fenetre de terminal va s'ouvrir pour l'etape \"{cmd}\".",
    ifNothingOpens: "[coffre] Si rien ne s'ouvre, lance ceci a la main dans un terminal :\n           {cmd}",
    osascriptFailed: "[coffre] Impossible d'ouvrir le Terminal{detail}.",
    osascriptFix: "[coffre] Autorise Terminal dans Reglages Systeme -> Confidentialite et securite -> Automatisation, puis reessaie, ou lance la commande ci-dessus a la main.",
    noEmulator: "[coffre] Aucune fenetre de terminal n'a pu etre ouverte. Lance ceci a la main : {cmd}",
    windowTimeout: "[coffre] Abandon de l'attente de la fenetre de terminal.",
  },
};

// The window runs in a bare console. On Windows that console is very often a
// legacy code page (cp850/cp1252) where accented characters render as mojibake,
// and we cannot reliably fix that from here. So the translations above are
// written WITHOUT accents on purpose: slightly rough to read, but correct
// everywhere. Do not "fix" them by adding accents back.

export function resolveLang(flag) {
  const candidate = flag && flag !== "true" ? flag : osLocale();
  const short = String(candidate || "").slice(0, 2).toLowerCase();
  return STRINGS[short] ? short : "en";
}

function osLocale() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return "en";
  }
}

export function makeT(lang) {
  const dict = STRINGS[lang] || STRINGS.en;
  return (key, vars = {}) => {
    const template = dict[key] ?? STRINGS.en[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
  };
}
