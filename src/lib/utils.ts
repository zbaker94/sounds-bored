import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// navigator.userAgentData (Client Hints API) is not in TypeScript's DOM lib at ES2022.
// Declare it locally — it exists in Chromium-based runtimes (WebView2, Chrome 89+).
declare global {
  interface Navigator {
    readonly userAgentData?: { readonly platform: string };
  }
}

/**
 * Detect macOS. Prefers the Client Hints API (navigator.userAgentData.platform)
 * available in Chromium-based runtimes (WebView2 on Windows/Linux).
 * Falls back to navigator.userAgent for WebKit-based runtimes (WKWebView on macOS),
 * which do not implement the Client Hints API.
 */
export function detectIsMac(): boolean {
  const platform = navigator.userAgentData?.platform;
  if (platform) {
    return /mac/i.test(platform);
  }
  // userAgentData not available (WKWebView / older browsers) — fall back.
  // Exclude iPhone/iPad which also report "Mac" in their user agent on some UA strings.
  return /mac/i.test(navigator.userAgent) && !/iphone|ipad/i.test(navigator.userAgent);
}

// Evaluated once at module load time. Tests that need to control this value
// should mock detectIsMac() directly rather than stubbing navigator after import.
export const isMac = detectIsMac();

/** Returns "⌘" on Mac, "Ctrl" elsewhere. */
export const modKey = isMac ? "⌘" : "Ctrl"

/**
 * Truncates a file path with an ellipsis in the middle, preserving the
 * filename and a leading portion of the path.
 * e.g. "/very/long/path/to/file.wav" → "/very/long/…/file.wav"
 */
export function truncatePath(path: string, maxLength = 40): string {
  if (path.length <= maxLength) return path;
  const sep = path.includes("/") ? "/" : "\\";
  const filename = path.split(/[\\/]/).pop() ?? path;
  // Keep at least the filename; if filename alone exceeds limit, just truncate end
  if (filename.length >= maxLength - 1) return `…${filename.slice(-(maxLength - 1))}`;
  const keep = maxLength - filename.length - 2; // −2 for "…" + sep
  return `${path.slice(0, keep)}…${sep}${filename}`;
}
