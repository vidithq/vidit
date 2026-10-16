// Push-only service worker. It registers no fetch handler and opens no cache,
// so it never serves a page or intercepts a request. The payload is the
// backend's PushMessage (backend/app/services/push.py): { title, body, path }.

const FALLBACK_PATH = "/notifications";

// Only an app path opens on click, so a payload cannot send the reader off-site.
function appPath(path) {
  return typeof path === "string" && /^\/(?![/\\])/.test(path) ? path : FALLBACK_PATH;
}

function readMessage(data) {
  try {
    return (data && data.json()) || {};
  } catch {
    return {};
  }
}

self.addEventListener("push", (event) => {
  const message = readMessage(event.data);
  event.waitUntil(
    self.registration.showNotification(message.title || "Vidit", {
      body: message.body || "",
      icon: "/icon/android-192",
      data: { path: appPath(message.path) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = appPath(event.notification.data && event.notification.data.path);
  const url = new URL(path, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (!open) return self.clients.openWindow(url);
      return open
        .focus()
        .then((client) => client.navigate(url))
        .catch(() => self.clients.openWindow(url));
    }),
  );
});
