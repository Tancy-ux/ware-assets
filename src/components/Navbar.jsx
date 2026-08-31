import { LogOut } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

export default function Navbar() {
  const isAuth = localStorage.getItem("auth") === "true";
  const navigate = useNavigate();

  function handleLogout() {
    localStorage.removeItem("auth");
    navigate("/login");
  }

  return (
    <div className="sticky top-0 z-50 bg-green text-white">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-x-6 px-4 py-3 md:px-8">
        {/* Logo */}
        <Link
          to="/"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="shrink-0"
        >
          <img
            src={`${import.meta.env.BASE_URL}ware-white-transparent.png`}
            alt="ware"
            className="h-7 md:h-8 w-auto"
          />
        </Link>

        {/* Navigation */}
        <div className="flex items-center gap-3 sm:gap-4 text-sm sm:text-base font-semibold">
          <Link to="/faq" className="hover:opacity-70 transition">
            FAQs
          </Link>

          <span className="hidden md:inline text-white/30">|</span>

          {!isAuth && (
            <Link to="/login" className="hover:opacity-70 transition">
              Login
            </Link>
          )}

          {isAuth && (
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 md:gap-2 hover:opacity-70 transition"
            >
              <LogOut size={18} />
              <span className="hidden sm:inline">Logout</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
