import "./App.css";
import { StartScreen } from "@/components/screens/start/StartScreen";
import { MainPage } from "@/components/screens/main/MainPage";
import { CurrentProjectProvider } from "@/state/currentProjectStore.tsx";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AppErrorBoundary, RouteErrorElement } from "@/components/ErrorBoundary";

function App() {
  return (
    <AppErrorBoundary>
      <CurrentProjectProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<StartScreen />} errorElement={<RouteErrorElement />} />
            <Route path="/main" element={<MainPage />} errorElement={<RouteErrorElement />} />
          </Routes>
          <Toaster />
        </BrowserRouter>
      </CurrentProjectProvider>
    </AppErrorBoundary>
  );
}

export default App;
