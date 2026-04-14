import "./App.css";
import { StartScreen } from "@/components/screens/start/StartScreen";
import { MainPage } from "@/components/screens/main/MainPage";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AppErrorBoundary, RouteErrorElement } from "@/components/ErrorBoundary";
import { useBootLoader } from "@/hooks/useBootLoader";
import { useUpdater } from "@/hooks/useUpdater";
import { usePreloadImages } from "@/hooks/usePreloadImages";
import { LoadingScreen } from "@/components/screens/LoadingScreen";
import { SettingsDialog } from "@/components/modals/SettingsDialog";

function App() {
  const { ready: bootReady } = useBootLoader();
  useUpdater();
  const { ready: imagesReady } = usePreloadImages();

  return (
    <AppErrorBoundary>
      {(!bootReady || !imagesReady) && <LoadingScreen />}
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<StartScreen />} errorElement={<RouteErrorElement />} />
          <Route path="/main" element={<MainPage />} errorElement={<RouteErrorElement />} />
        </Routes>
        <Toaster />
        <SettingsDialog />
      </BrowserRouter>
    </AppErrorBoundary>
  );
}

export default App;
