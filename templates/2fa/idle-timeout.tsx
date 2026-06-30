"use client";

import { useEffect, useRef } from "react";
import { signOut } from "next-auth/react";

const IDLE_MS = 30 * 60 * 1000; // 30 min
const CHECK_MS = 30 * 1000;

/**
 * Déconnecte automatiquement après une période sans activité.
 * Toute interaction (souris, clavier, scroll, tactile) remet le minuteur à zéro.
 * À monter dans le layout de la zone protégée.
 */
export function IdleTimeout() {
  const last = useRef(Date.now());

  useEffect(() => {
    const bump = () => {
      last.current = Date.now();
    };
    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));

    const id = setInterval(() => {
      if (Date.now() - last.current >= IDLE_MS) {
        clearInterval(id);
        void signOut({ callbackUrl: "/admin/signin" });
      }
    }, CHECK_MS);

    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(id);
    };
  }, []);

  return null;
}
