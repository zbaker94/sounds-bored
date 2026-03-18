import { useState, useEffect } from "react";

// Tailwind v4 default breakpoints — hardcoded to avoid relying on
// getComputedStyle for CSS custom properties, which is unreliable in
// Tauri's WebKit webview at initialization time.
const BREAKPOINTS: Record<string, string> = {
  sm: "40rem",
  md: "48rem",
  lg: "64rem",
  xl: "80rem",
  "2xl": "96rem",
};

/** Returns true when the viewport is at or above the named Tailwind breakpoint. */
export function useBreakpoint(name: keyof typeof BREAKPOINTS): boolean {
  const query = `(min-width: ${BREAKPOINTS[name] ?? "48rem"})`;
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mq = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [query]);

  return matches;
}

/** Convenience hook for the `md` breakpoint. */
export function useIsMd(): boolean {
  return useBreakpoint("md");
}
