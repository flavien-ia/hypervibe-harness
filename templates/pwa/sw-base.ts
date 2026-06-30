/// <reference lib="webworker" />
// hypervibe:pwa-sw
// Service worker de base (Serwist). /add-push-notification y insère les handlers
// "push" et "notificationclick" au marker "hypervibe:push-handlers" plus bas.
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

// Serwist injecte la liste des assets à pré-cacher dans self.__SW_MANIFEST au build.
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  // defaultCache (Next) = NetworkFirst sur les pages/données : contenu frais dès
  // qu'il y a du réseau, cache en secours hors-ligne (périmètre offline minimal).
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();

// hypervibe:push-handlers
// (les handlers de notifications push sont ajoutés ici par /add-push-notification)
