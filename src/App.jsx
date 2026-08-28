import { Route, Routes, useLocation } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import HomePage from "./Pages/HomePage";
import Colors from "./components/Colors";
import Logos from "./components/Logos";
import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import Footer from "./components/Footer";
import Fonts from "./components/Fonts";
import Login from "./components/Login";
import ProtectedRoute from "./components/ProtectedRoute";
import AssetLibrary from "./components/AssetLibrary";
import Faq from "./components/Faq";

function App() {
  const location = useLocation();
  const hideHero = location.pathname === "/login" || location.pathname === "/faq";

  return (
    <div className="min-h-screen bg-[#eef2e8] flex flex-col">
      <Navbar />

      {/* Hero is the homepage's intro banner — skip it on /login and /faq,
          which have their own page context and don't need it repeated. */}
      {!hideHero && <Hero />}

      <Routes>
        <Route path="/login" element={<Login />} />

        <Route
          path="/"
          element={
            <ProtectedRoute>
              <HomePage />
            </ProtectedRoute>
          }
        />
        <Route path="/assets" element={<AssetLibrary />} />
        <Route path="/faq" element={<Faq />} />

        <Route
          path="/colors"
          element={
            <ProtectedRoute>
              <Colors />
            </ProtectedRoute>
          }
        />

        <Route
          path="/logos"
          element={
            <ProtectedRoute>
              <Logos />
            </ProtectedRoute>
          }
        />

        <Route
          path="/fonts"
          element={
            <ProtectedRoute>
              <Fonts />
            </ProtectedRoute>
          }
        />
      </Routes>

      <ToastContainer />
    </div>
  );
}
export default App;
