const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/**
 * CSP `nonce-source` is a base64 alphabet (`ALPHA / DIGIT / "+" / "/" / "-" / "_"`).
 * A `.` from `String(Math.random())` makes the source invalid, so the webview
 * script is blocked and the host waits forever on `webviewReady`.
 */
export function createWebviewNonce(): string {
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
  }
  return text;
}

export function isCspNonce(value: string): boolean {
  return /^[A-Za-z0-9+/_-]{16,}$/.test(value);
}
