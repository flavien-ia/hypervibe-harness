// Notifications push : bloc inséré par /add-push-notification dans le service
// worker créé par /add-pwa (src/app/sw.ts), juste après le marker
// "hypervibe:push-handlers". Ne pas dupliquer si déjà présent.
self.addEventListener("push", (event) => {
  let data: { title?: string; body?: string; url?: string } = {};
  try {
    data = (event.data?.json() ?? {}) as { title?: string; body?: string; url?: string };
  } catch {
    data = { body: event.data?.text() };
  }
  const title = data.title ?? "__APP_NAME__";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body ?? "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: data.url ?? "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string })?.url ?? "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if ("focus" in client) {
            void client.focus();
            if ("navigate" in client) void client.navigate(url);
            return;
          }
        }
        return self.clients.openWindow(url);
      }),
  );
});
