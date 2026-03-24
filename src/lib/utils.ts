import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const isMac = /mac/i.test(navigator.userAgent) && !/iphone|ipad/i.test(navigator.userAgent)

/** Returns "⌘" on Mac, "Ctrl" elsewhere. */
export const modKey = isMac ? "⌘" : "Ctrl"
