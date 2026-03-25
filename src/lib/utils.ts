import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const isMac = /mac/i.test(navigator.userAgent) && !/iphone|ipad/i.test(navigator.userAgent)

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
