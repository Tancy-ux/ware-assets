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

function App() {
  const location = useLocation();
  const hideHero = location.pathname === "/login";

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <Navbar />

      {/* Show Hero on all pages except /login */}
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
