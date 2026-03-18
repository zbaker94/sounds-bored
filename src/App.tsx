import "./App.css";
import { StartScreen } from "@/components/screens/start/StartScreen";
import { MainPage } from "@/components/screens/main/MainPage";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AppErrorBoundary, RouteErrorElement } from "@/components/ErrorBoundary";
import { useAppSettings } from "@/lib/appSettings.queries";

function App() {
  useAppSettings();

  return (
    <AppErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<StartScreen />} errorElement={<RouteErrorElement />} />
          <Route path="/main" element={<MainPage />} errorElement={<RouteErrorElement />} />
        </Routes>
        <Toaster />
      </BrowserRouter>
    </AppErrorBoundary>
  );
}

export default App;
