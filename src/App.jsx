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

      <Routes>
        <Route path="/login" element={<Login />} />

        <Route path="/" element={<HomePage />} />
        <Route path="/assets" element={<AssetLibrary />} />
        <Route path="/faq" element={<Faq />} />
        <Route path="/colors" element={<Colors />} />
        <Route path="/logos" element={<Logos />} />
        <Route path="/fonts" element={<Fonts />} />
      </Routes>

      <ToastContainer />
    </div>
  );
}
export default App;
