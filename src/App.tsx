import "./App.css";
import { StartScreen } from "@/components/screens/start/StartScreen";
import { MainPage } from "@/components/screens/main/MainPage";
import { CurrentProjectProvider } from "@/state/currentProjectStore.tsx";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";

function App() {
  return (
    <CurrentProjectProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<StartScreen />} />
          <Route path="/main" element={<MainPage />} />
        </Routes>
        <Toaster />
      </BrowserRouter>
    </CurrentProjectProvider>
  );
}

export default App;
