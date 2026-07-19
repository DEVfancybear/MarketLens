export const EMBEDDED_BROWSER_AUTH_CODE = "auth/disallowed-useragent";

const EMBEDDED_BROWSER_MARKERS =
  /FBAN|FBAV|Instagram|Line\/|Zalo|TikTok|BytedanceWebview|GSA\/|; wv\)|\bwv\b/i;
const IOS_DEVICE = /iPhone|iPad|iPod/i;
const IOS_SYSTEM_BROWSER = /Safari|CriOS|FxiOS|EdgiOS|OPiOS/i;

/** Google OAuth rejects embedded app browsers with `disallowed_useragent`. */
export function isEmbeddedAppBrowser(userAgent: string): boolean {
  if (EMBEDDED_BROWSER_MARKERS.test(userAgent)) return true;

  // iOS webviews expose AppleWebKit but omit every known system-browser token.
  return (
    IOS_DEVICE.test(userAgent) &&
    /AppleWebKit/i.test(userAgent) &&
    !IOS_SYSTEM_BROWSER.test(userAgent)
  );
}

export function assertGoogleAuthBrowser(userAgent: string): void {
  if (!isEmbeddedAppBrowser(userAgent)) return;

  throw Object.assign(
    new Error(
      "Google blocks sign-in inside this app browser. Use the top-right menu to open tradingterminal.io.vn in Safari or Chrome, then sign in again.",
    ),
    { code: EMBEDDED_BROWSER_AUTH_CODE },
  );
}
