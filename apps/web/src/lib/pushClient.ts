// Phase 21 §5.4 & §5.5: Web Push registration, iOS standalone detection, soft-ask helper & logout cleanup.
import { phase21Api } from './phase21Api';

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function isIosDevice(): boolean {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
}

export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    Boolean((navigator as any).standalone)
  );
}

export function isIosSafariNotInstalled(): boolean {
  return isIosDevice() && !isStandalonePwa();
}

export function detectPlatform(): 'ANDROID' | 'IOS' | 'DESKTOP' | 'OTHER' {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'ANDROID';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'IOS';
  if (/Windows|Macintosh|Linux/i.test(ua)) return 'DESKTOP';
  return 'OTHER';
}

export function detectBrowser(): string {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Browser';
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** Called strictly from a user click handler ("Enable notifications"). */
export async function enableBrowserPush(customLabel?: string): Promise<{ ok: boolean; reason?: string }> {
  if (!pushSupported()) return { ok: false, reason: 'Push notifications are not supported in this browser.' };
  if (isIosSafariNotInstalled()) {
    return {
      ok: false,
      reason: 'On iPhone/iPad, tap Share -> Add to Home Screen first, then open Sawant ERP from your Home Screen.',
    };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { ok: false, reason: 'Permission was not granted in browser settings.' };
  }

  const keyRes = await phase21Api.getVapidPublicKey();
  if (!keyRes.publicKey) {
    return { ok: false, reason: 'VAPID public key is not configured on the server yet.' };
  }

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(keyRes.publicKey) as BufferSource,
    });
  }

  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return { ok: false, reason: 'Browser push subscription keys missing.' };
  }

  const platform = detectPlatform();
  const browser = detectBrowser();
  await phase21Api.subscribePush({
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    platform,
    browser,
    deviceLabel: customLabel || `${platform} ${browser}`,
    standalone: isStandalonePwa(),
  });
  return { ok: true };
}

export async function clearPushAndSwOnLogout(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          const devices = await phase21Api.listMyDevices().catch(() => []);
          await sub.unsubscribe().catch(() => undefined);
          for (const d of devices) {
            await phase21Api.revokeDevice(d.id).catch(() => undefined);
          }
        }
        reg.active?.postMessage({ type: 'CLEAR_USER_CACHE' });
      }
    }
  } catch {
    // Non-blocking on logout
  }
}

