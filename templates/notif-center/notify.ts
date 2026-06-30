// hypervibe:notification-center
// Point d'entrée unique "notifier un utilisateur" : persiste la notification (pour
// le centre in-app / la cloche) et, si /add-push-notification est installé, envoie
// aussi une notification système (push). Utilise ceci partout côté serveur pour
// notifier quelqu'un :  await notifyUser(db, userId, { title, body, url })
import type { db as dbClient } from "~/server/db";
import { notifications } from "~/server/db/schema";

export type NotifyPayload = {
  title: string;
  body: string;
  url?: string;
};

export async function notifyUser(
  db: typeof dbClient,
  userId: string,
  payload: NotifyPayload,
): Promise<void> {
  // 1) Persister pour le centre de notifications in-app (cloche + historique).
  await db.insert(notifications).values({
    userId,
    title: payload.title,
    body: payload.body,
    url: payload.url ?? null,
  });

  // 2) Push système (branché ici par /add-push-notification au marker ci-dessous).
  // hypervibe:notify-push
}
