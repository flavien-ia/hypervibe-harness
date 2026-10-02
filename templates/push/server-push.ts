// hypervibe:push
// Notifications push (Web Push). Helper d'envoi côté serveur. Le marker ci-dessus
// sert à la détection par /add-push-notification (re-run) et /add-notification-center
// (câblage de notifyUser) : ne pas le retirer.
// VAPID lu depuis l'environnement (NEXT_PUBLIC_VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY, VAPID_SUBJECT) configuré par /add-push-notification.
import webpush from "web-push";
import { eq } from "drizzle-orm";
import type { db as dbClient } from "~/server/db";
import { pushSubscriptions } from "~/server/db/schema";

let configured = false;
function ensureConfigured(): boolean {
  if (configured) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  // Must be a valid mailto: or https: URL or web-push throws. Safe default if
  // unset (set VAPID_SUBJECT to your contact email).
  const subject = process.env.VAPID_SUBJECT ?? "mailto:admin@example.com";
  if (!pub || !priv) return false;
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
  return true;
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
};

// Les services de notification des navigateurs. L'adresse d'un abonnement est
// déclarée par l'appareil : sans cette liste, un utilisateur connecté pourrait
// enregistrer n'importe quelle adresse et faire envoyer au serveur des requêtes
// où il veut (SSRF). Un hôte de la liste, ou l'un de ses sous-domaines.
// Un navigateur qui passerait par un autre service ne pourrait plus s'abonner :
// l'ajouter ici, après avoir vérifié à qui appartient l'hôte.
const PUSH_SERVICE_HOSTS = [
  "fcm.googleapis.com", // Chrome, Edge, Opera, Brave, Samsung Internet
  "jmt17.google.com", // Chrome, versions de préversion (Canary, Dev)
  "updates.push.services.mozilla.com", // Firefox
  "web.push.apple.com", // Safari (macOS, iOS, iPadOS)
  "notify.windows.com", // Edge sous Windows (wns2-xxx.notify.windows.com)
];

/** L'adresse déclarée par l'appareil est-elle bien celle d'un service de notification ? */
export function isPushServiceEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.port || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    return PUSH_SERVICE_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
  } catch {
    return false;
  }
}

/** Envoie une notification à tous les appareils d'un utilisateur. Nettoie les abonnements morts (404/410). */
export async function sendPushToUser(
  db: typeof dbClient,
  userId: string,
  payload: PushPayload,
): Promise<number> {
  if (!ensureConfigured()) return 0;
  const subs = await db.query.pushSubscriptions.findMany({
    where: eq(pushSubscriptions.userId, userId),
  });
  let sent = 0;
  const body = JSON.stringify(payload);
  for (const s of subs) {
    // Une adresse enregistrée avant la liste des services ne reçoit rien.
    if (!isPushServiceEndpoint(s.endpoint)) continue;
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
      );
      sent++;
    } catch (err: unknown) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, s.endpoint));
      } else {
        console.error("[push] send failed", status);
      }
    }
  }
  return sent;
}
