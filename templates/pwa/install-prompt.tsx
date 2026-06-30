"use client";

// Petite fenêtre invitant l'utilisateur à installer l'app (mobile/tablette).
// - Android / Chrome : bouton "Installer" qui déclenche le prompt natif.
// - iOS Safari : pas de prompt natif, on affiche les instructions "Ajouter à
//   l'écran d'accueil" (icône Partager puis "Sur l'écran d'accueil").
// Masquée si l'app est déjà installée, sur desktop, ou récemment fermée.
//
// /add-pwa adapte les couleurs (bg-foreground/bg-background ci-dessous) à la
// palette du projet et remplace __APP_NAME__ / __LOGO_LETTER__.
import { useEffect, useState } from "react";
import { IosShareIcon } from "~/components/ios-share-icon";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "hv-install-dismissed-at";
// Si l'utilisateur ferme le bandeau, on le ré-affiche après ce délai.
const REAPPEAR_AFTER_MS = 3 * 24 * 60 * 60 * 1000; // 3 jours

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIos, setShowIos] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    if (dismissedAt && Date.now() - dismissedAt < REAPPEAR_AFTER_MS) return;

    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) return; // déjà installée

    // Mobile / tablette uniquement : pas de bandeau d'installation sur desktop.
    if (!window.matchMedia("(pointer: coarse)").matches) return;

    // Android / Chrome : prompt natif
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    // iOS Safari : pas de prompt natif, on affiche les instructions A2HS.
    const ua = window.navigator.userAgent;
    const isIos =
      /iphone|ipad|ipod/i.test(ua) ||
      (ua.includes("Macintosh") && navigator.maxTouchPoints > 1); // iPadOS
    const isSafari = /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
    if (isIos && isSafari) {
      setShowIos(true);
      setVisible(true);
    }

    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    dismiss();
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background px-5 py-4 text-foreground shadow-lg sm:inset-x-auto sm:bottom-5 sm:right-5 sm:max-w-sm sm:rounded-xl sm:border">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-foreground text-sm font-extrabold text-background">
          __LOGO_LETTER__
        </span>
        <div className="flex-1 text-sm">
          <p className="font-semibold">Installer l’app __APP_NAME__</p>
          {showIos ? (
            <p className="mt-1 text-muted-foreground">
              Appuie sur{" "}
              <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                <IosShareIcon className="inline size-4 align-text-bottom" />
                Partager
              </span>{" "}
              puis <span className="font-semibold text-foreground">« Sur l’écran d’accueil »</span>.
            </p>
          ) : (
            <p className="mt-1 text-muted-foreground">
              Accès direct depuis ton écran d’accueil, en plein écran.
            </p>
          )}
          <div className="mt-3 flex gap-2">
            {!showIos && deferred && (
              <button
                onClick={() => void install()}
                className="cursor-pointer rounded-md bg-foreground px-4 py-2 text-xs font-semibold text-background transition hover:opacity-80"
              >
                Installer
              </button>
            )}
            <button
              onClick={dismiss}
              className="cursor-pointer rounded-md border border-border px-4 py-2 text-xs font-semibold transition hover:bg-muted"
            >
              Plus tard
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
