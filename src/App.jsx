import { lazy, Suspense, useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { supabase } from "./components/supabase";
import { ToastContainer } from "react-toastify";
import HomePage from "./Pages/HomePage";
import Navbar from "./components/Navbar";
import Login from "./components/Login";

// Each page loads when it's opened, so WareBot (the Chats admin) doesn't
// download the brand pages and the FAQ, and the other way round.
const Colors = lazy(() => import("./components/Colors"));
const Logos = lazy(() => import("./components/Logos"));
const Fonts = lazy(() => import("./components/Fonts"));
const AssetLibrary = lazy(() => import("./components/AssetLibrary"));
const Faq = lazy(() => import("./components/Faq"));
const ChatLogs = lazy(() => import("./components/ChatLogs"));

function App() {
  // The edit buttons follow the "auth" flag, but saving needs a real
  // Supabase session. Anyone flagged without one (signed in with the old
  // shared password, or their session ended) goes back to signed out.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session && localStorage.getItem("auth") === "true") {
        localStorage.removeItem("auth");
        window.location.reload();
      }
    });
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") localStorage.removeItem("auth");
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // WareBot (the Chats admin) is its own page: no site header, its own
  // tab title.
  const { pathname } = useLocation();
  const standalone = pathname.replace(/\/+$/, "") === "/chats";
  useEffect(() => {
    if (!standalone) return;
    const before = document.title;
    document.title = "WareBot";
    return () => {
      document.title = before;
    };
  }, [standalone]);
  if (standalone) {
    return (
      <>
        <Suspense fallback={null}>
          <ChatLogs />
        </Suspense>
        <ToastContainer />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-[#eef2e8] flex flex-col">
      <Navbar />

      {/* Ask AI's push-content effect (see #page-content in Faq.css)
          targets this wrapper, not body, so the navbar above it always
          stays full-width and never shifts when the drawer opens. */}
      <div id="page-content">
        <Suspense fallback={null}>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route path="/" element={<HomePage />} />
          <Route path="/assets" element={<AssetLibrary />} />
          <Route path="/faq" element={<Faq />} />
          <Route path="/chats" element={<ChatLogs />} />
          <Route path="/colors" element={<Colors />} />
          <Route path="/logos" element={<Logos />} />
          <Route path="/fonts" element={<Fonts />} />
        </Routes>
        </Suspense>
      </div>

      <ToastContainer />
    </div>
  );
}
export default App;
