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
    <div className="bg-[#eef2e8] text-green">
      <div className="max-w-8xl mx-auto flex items-center justify-between px-4 py-4 md:px-12">
        {/* Logo */}
        <Link
          to="/"
          className="font-bold tracking-tight text-lg sm:text-xl md:text-3xl"
        >
          Ware Innovations
        </Link>

        {/* Navigation */}
        <div className="flex items-center gap-3 sm:gap-4 md:gap-6 text-sm sm:text-base md:text-lg font-semibold">
          <Link to="/assets" className="hover:opacity-70 transition">
            Downloads
          </Link>

          {/* separator only desktop */}
          <span className="hidden md:inline">|</span>

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
