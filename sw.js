// service worker: only shows notifications (phones need one); it caches nothing
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type:"window", includeUncontrolled:true }).then((tabs) =>
      tabs.length ? tabs[0].focus() : self.clients.openWindow("./")
    )
  );
});
