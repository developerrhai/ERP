// Cross-tab auth sync over BroadcastChannel('rhai-auth'): a logout in one tab signs out every
// tab (CONTRACT §8), and a successful refresh is announced so tabs know the cookie just rotated.

export const AUTH_CHANNEL = 'rhai-auth';

type AuthMessage = { type: 'logout' } | { type: 'refreshed'; at: number };

function isLogout(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'logout'
  );
}

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  channel ??= new BroadcastChannel(AUTH_CHANNEL);
  return channel;
}

export function broadcastLogout(): void {
  getChannel()?.postMessage({ type: 'logout' } satisfies AuthMessage);
}

/** Tells other tabs the shared refresh cookie was just rotated by this tab. */
export function broadcastRefreshed(): void {
  getChannel()?.postMessage({ type: 'refreshed', at: Date.now() } satisfies AuthMessage);
}

export function onRemoteLogout(callback: () => void): () => void {
  const ch = getChannel();
  if (!ch) return () => undefined;
  const handler = (event: MessageEvent<unknown>): void => {
    if (isLogout(event.data)) callback();
  };
  ch.addEventListener('message', handler);
  return () => ch.removeEventListener('message', handler);
}

export function closeChannelForTests(): void {
  channel?.close();
  channel = null;
}
