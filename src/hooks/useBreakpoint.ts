import { useState, useEffect } from "react";

function getBreakpointQuery(name: string): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(`--breakpoint-${name}`)
    .trim();
  return `(min-width: ${value})`;
}

/** Returns true when the viewport is at or above the named Tailwind breakpoint. */
export function useBreakpoint(name: string): boolean {
  const [matches, setMatches] = useState(() =>
    window.matchMedia(getBreakpointQuery(name)).matches
  );

  useEffect(() => {
    const mq = window.matchMedia(getBreakpointQuery(name));
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [name]);

  return matches;
}

/** Convenience hook for the `md` breakpoint. */
export function useIsMd(): boolean {
  return useBreakpoint("md");
}
