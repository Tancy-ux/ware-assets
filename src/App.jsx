import { Route, Routes } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import HomePage from "./Pages/HomePage";
import Colors from "./components/Colors";
import Logos from "./components/Logos";
import Navbar from "./components/Navbar";
import Fonts from "./components/Fonts";
import Login from "./components/Login";
import AssetLibrary from "./components/AssetLibrary";
import Faq from "./components/Faq";

function App() {
  return (
    <div className="min-h-screen bg-[#eef2e8] flex flex-col">
      <Navbar />

      {/* Ask AI's push-content effect (see #page-content in Faq.css)
          targets this wrapper, not body, so the navbar above it always
          stays full-width and never shifts when the drawer opens. */}
      <div id="page-content">
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route path="/" element={<HomePage />} />
          <Route path="/assets" element={<AssetLibrary />} />
          <Route path="/faq" element={<Faq />} />
          <Route path="/colors" element={<Colors />} />
          <Route path="/logos" element={<Logos />} />
          <Route path="/fonts" element={<Fonts />} />
        </Routes>
      </div>

      <ToastContainer />
    </div>
  );
}
export default App;
