// hypervibe:pwa
// Web App Manifest (Next.js App Router). Détecté par /add-push-notification
// via le marker "hypervibe:pwa" ci-dessus. Ne pas retirer ce commentaire.
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "__APP_NAME__",
    short_name: "__SHORT_NAME__",
    description: "__APP_DESCRIPTION__",
    start_url: "/",
    display: "standalone",
    background_color: "__BG_COLOR__",
    theme_color: "__THEME_COLOR__",
    lang: "__LANG__",
    orientation: "portrait",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
