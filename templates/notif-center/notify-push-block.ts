// Bloc de câblage push <-> centre de notifications. À injecter dans
// src/server/notify.ts UNIQUEMENT quand src/server/push.ts existe (sinon erreur de
// build : module introuvable). Deux insertions, faites par la skill qui arrive en
// second (/add-push-notification si le centre est déjà là, ou /add-notification-center
// si le push est déjà là). Idempotent : ne pas réinjecter si déjà présent.
//
// (a) En tête de notify.ts, à côté des autres imports :
//
//     import { sendPushToUser } from "~/server/push";
//
// (b) À la place de la ligne marker "// hypervibe:notify-push" dans notifyUser :
//
//     await sendPushToUser(db, userId, payload);
