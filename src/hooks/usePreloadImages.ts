import { useState, useEffect } from "react";

import backgroundScroll from "@/assets/background-scroll.gif";
import sleepingKnight from "@/assets/sleeping knight-emblem.gif";

import corrugated from "@/assets/corrugated.gif";
import brickOverlay from "@/assets/brick-overlay.png";
import sideIllumination from "@/assets/side-illumination.png";
import gibbering from "@/assets/gibbering.gif";
import guyWithTorch from "@/assets/guywithtorch.gif";
import handsigil from "@/assets/handsigil.png";
import logo from "@/assets/soundsbored-logo.png";
import logoMoshed from "@/assets/soundsbored-logo-moshed.gif";
import logoMoshed2 from "@/assets/soundsbored-logo-moshed-2.gif";

// These must be ready before the app is shown.
const CRITICAL_SRCS = [backgroundScroll, sleepingKnight];

// These are preloaded in the background while the loading screen is visible.
const BACKGROUND_SRCS = [
  corrugated,
  brickOverlay,
  sideIllumination,
  gibbering,
  guyWithTorch,
  handsigil,
  logo,
  logoMoshed,
  logoMoshed2,
];

export function usePreloadImages(): { ready: boolean } {
  const [readyCount, setReadyCount] = useState(0);

  useEffect(() => {
    CRITICAL_SRCS.forEach((src) => {
      const img = new Image();
      img.onload = img.onerror = () => setReadyCount((n) => n + 1);
      img.src = src;
    });

    BACKGROUND_SRCS.forEach((src) => {
      new Image().src = src;
    });
  }, []);

  return { ready: readyCount >= CRITICAL_SRCS.length };
}
