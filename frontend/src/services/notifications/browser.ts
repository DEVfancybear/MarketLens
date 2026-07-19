/**
 * Browser (system) notifications via the Notification API. SSR- and
 * failure-safe; never throws. Permission is requested explicitly from the Alert
 * Center, never implicitly.
 */
export type BrowserPermission = NotificationPermission | 'unsupported';

export const NOTIFICATION_PERMISSION_BLOCKED_MESSAGE =
  "Notifications are blocked for this site. Open the tune/lock icon next to the address, set Notifications to Allow in Site settings, then reload.";

export function browserNotificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getBrowserPermission(): BrowserPermission {
  if (!browserNotificationsSupported()) return 'unsupported';
  return Notification.permission;
}

/** Ask the user to allow system notifications. Returns the resulting state. */
export async function requestBrowserPermission(): Promise<BrowserPermission> {
  if (!browserNotificationsSupported()) return 'unsupported';
  // Chromium blocks the prompt after repeated dismissals. Calling the API
  // again only produces a console warning; the user must change Site settings.
  if (Notification.permission === 'denied') return 'denied';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/** Show a system notification if (and only if) permission has been granted. */
export function showBrowserNotification(title: string, body: string): void {
  if (!browserNotificationsSupported() || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, tag: 'smc-alert', icon: '/favicon.ico' });
    // Focus the tab when the user clicks the notification.
    n.onclick = () => {
      try {
        window.focus();
        n.close();
      } catch {
        /* ignore */
      }
    };
  } catch {
    /* ignore */
  }
}
