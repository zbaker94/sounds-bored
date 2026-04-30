import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip"
import { initLogger, logInfo } from "@/lib/logger";

const rootEl = document.getElementById("root") as HTMLElement;

// Reuse the existing React root across Vite HMR cycles to prevent full
// unmount/remount. Without this, each HMR fallback-reload (e.g. after hook
// additions that break Fast Refresh) calls createRoot again, wipes React
// state, and leaves /main blank because MainPage's project guard fires before
// useProjectLifecycle can redirect.
if (!(rootEl as any).__reactRoot) {
  (rootEl as any).__reactRoot = ReactDOM.createRoot(rootEl);
}
const root = (rootEl as any).__reactRoot as ReturnType<typeof ReactDOM.createRoot>;

initLogger().then(() => { logInfo("App started"); }).catch(() => {});
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="light">
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
