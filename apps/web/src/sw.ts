/// <reference lib="webworker" />
// Phase 21 §5.4 & §5.5: Custom InjectManifest Service Worker
// - Precaches app shell assets only; `/api/**` is strictly NetworkOnly (zero financial stale cache).
// - Handles Web Push + Declarative payload + same-origin click navigation guard + app badge + pushsubscriptionchange.
import { clientsClaim } from 'workbox-core';
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkOnly } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

export const SW_VERSION = '21.0.0';

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST || []);
clientsClaim();

// Never cache any API responses — live financial, tax, and inventory truth always comes from network.
registerRoute(({ url }) => url.pathname.startsWith('/api/'), new NetworkOnly());

// Navigation fallback to offline page when network fails
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cached = await caches.match('/offline.html');
        return cached || new Response('Offline — network required', { status: 503 });
      }),
    );
  }
});

export function sanitizeSameOriginUrl(rawUrl: string | undefined, origin: string): string {
  try {
    const u = new URL(rawUrl || '/notifications', origin);
    if (u.origin !== origin) return `${origin}/notifications`;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return '/notifications';
  }
}

self.addEventListener('push', (event) => {
  const show = async () => {
    let payload: Record<string, any> = {};
    try {
      payload = event.data ? event.data.json() : {};
    } catch {
      payload = { title: 'Sawant Group ERP', body: event.data?.text() ?? '' };
    }

    const notifMeta = payload.notification ?? payload;
    const title = String(notifMeta.title || payload.title || 'Sawant Group ERP');
    const body = String(notifMeta.body || payload.body || 'New update waiting.');
    const targetUrl = sanitizeSameOriginUrl(notifMeta.navigate || payload.url, self.location.origin);
    const badgeCount = Number(notifMeta.app_badge ?? payload.badge ?? 0);
    const tag = payload.tag ? String(payload.tag).slice(0, 32) : undefined;

    if (typeof (self.navigator as any)?.setAppBadge === 'function') {
      if (badgeCount > 0) await (self.navigator as any).setAppBadge(badgeCount).catch(() => undefined);
      else await (self.navigator as any).clearAppBadge().catch(() => undefined);
    }

    await self.registration.showNotification(title, {
      body,
      tag,
      icon: '/icons/icon-192.svg',
      badge: '/icons/icon-192.svg',
      data: { url: targetUrl },
    });
  };
  event.waitUntil(show());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const safePath = sanitizeSameOriginUrl(event.notification.data?.url, self.location.origin);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          void client.focus();
          if ('navigate' in client) return (client as WindowClient).navigate(safePath);
          return client;
        }
      }
      return self.clients.openWindow(safePath);
    }),
  );
});

self.addEventListener('pushsubscriptionchange', (event: any) => {
  const renew = async () => {
    try {
      const sub = await self.registration.pushManager.subscribe(
        event.oldSubscription?.options ?? { userVisibleOnly: true },
      );
      const json = sub.toJSON();
      if (json.endpoint && json.keys?.p256dh && json.keys?.auth) {
        await fetch('/api/v1/push/subscriptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            endpoint: json.endpoint,
            p256dh: json.keys.p256dh,
            auth: json.keys.auth,
            platform: 'DESKTOP',
            browser: 'Browser',
          }),
        });
      }
    } catch {
      // Best-effort renewal
    }
  };
  event.waitUntil(renew());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
  if (event.data?.type === 'CLEAR_USER_CACHE') {
    event.waitUntil(
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((k) => !k.includes('workbox-precache'))
            .map((k) => caches.delete(k)),
        ),
      ),
    );
  }
});

