"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// Public helper - call this from any button (footer, settings page, etc.)
// to re-open the cookie consent banner so the user can change their choice.
// CNIL requires that withdrawing consent is as easy as giving it.
export function openCookiePreferences() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("cookie-preferences-open"));
  }
}

export function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Show banner on first visit (no choice yet).
    if (!localStorage.getItem("cookie-consent")) {
      setVisible(true);
    }
    // Listen for re-open requests (from footer link, etc.).
    const open = () => setVisible(true);
    window.addEventListener("cookie-preferences-open", open);
    return () => window.removeEventListener("cookie-preferences-open", open);
  }, []);

  function accept() {
    localStorage.setItem("cookie-consent", "accepted");
    setVisible(false);
    window.dispatchEvent(new Event("cookie-consent-change"));
  }

  function refuse() {
    localStorage.setItem("cookie-consent", "refused");
    setVisible(false);
    // Dispatch on refuse too - so any tracker that was loaded after a previous
    // "accept" can react (clean up dataLayer, stop sending events, etc.).
    window.dispatchEvent(new Event("cookie-consent-change"));
  }

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 max-w-sm rounded-xl border border-white/10 bg-black/90 px-4 py-3 shadow-lg backdrop-blur-sm">
      <p className="text-xs text-white/60">
        Ce site utilise des cookies à des fins de mesure d&apos;audience.{" "}
        <Link href="/politique-de-confidentialite" className="underline hover:text-white">
          Politique de confidentialité
        </Link>
      </p>
      <div className="mt-2 flex gap-2">
        <button
          onClick={refuse}
          className="cursor-pointer rounded-md border border-white/20 px-3 py-1 text-xs text-white/60 transition hover:bg-white/10"
        >
          Refuser
        </button>
        <button
          onClick={accept}
          className="cursor-pointer rounded-md bg-white px-3 py-1 text-xs font-medium text-black transition hover:bg-white/90"
        >
          Accepter
        </button>
      </div>
    </div>
  );
}
