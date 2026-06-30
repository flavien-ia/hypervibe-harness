"use client";

// Bouton "Activer les notifications" : demande la permission, abonne l'appareil
// via PushManager (clé VAPID publique), et enregistre l'abonnement côté serveur.
// À placer dans une zone connectée (compte, dashboard). /add-push-notification
// adapte le wording et les couleurs à la palette du projet.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "~/trpc/react";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function EnableNotifications() {
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const status = api.push.status.useQuery(undefined, { retry: false });
  const subscribe = api.push.subscribe.useMutation();
  const utils = api.useUtils();

  useEffect(() => {
    setSupported(
      typeof window !== "undefined" &&
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window,
    );
  }, []);

  if (!supported) return null;
  if (status.data?.subscribed) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border px-4 py-3 text-xs font-semibold text-muted-foreground">
        <span className="size-2 rounded-full bg-foreground" />
        Notifications activées sur cet appareil
      </div>
    );
  }

  async function enable() {
    setBusy(true);
    try {
      const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapid) {
        toast.error("Notifications non configurées.");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast.error("Notifications refusées. Tu peux les réactiver dans les réglages de ton navigateur.");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapid),
      });
      const json = sub.toJSON();
      await subscribe.mutateAsync({
        endpoint: sub.endpoint,
        p256dh: json.keys?.p256dh ?? "",
        auth: json.keys?.auth ?? "",
      });
      await utils.push.status.invalidate();
      toast.success("Notifications activées sur cet appareil.");
    } catch (err) {
      console.error(err);
      toast.error("Impossible d'activer les notifications sur cet appareil.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void enable()}
      disabled={busy}
      className="flex cursor-pointer items-center gap-2 rounded-md border border-foreground px-4 py-3 text-xs font-semibold transition hover:bg-foreground hover:text-background disabled:opacity-50"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="size-4" aria-hidden>
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {busy ? "Activation…" : "Activer les notifications"}
    </button>
  );
}
