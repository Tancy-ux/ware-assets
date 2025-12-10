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
    <div className="bg-white text-green">
      <div className="flex items-center justify-between p-8 md:px-12">
        <Link
          to="/"
          className="text-green tracking-tight font-bold text-2xl md:text-4xl"
        >
          {/* <img src="/ware.png" alt="ware" className="h-12 w-32" /> */}
          Ware Innovations
        </Link>
        <div className="flex gap-4 md:gap-8 text-md font-semibold md:text-xl">
          <Link to="/#assets">Downloads</Link>
          <span> | </span>
          <Link to="/about">About Ware</Link>
          <span> | </span>
          {!isAuth && <Link to="/login">Login</Link>}
          {isAuth && (
            <button
              className="cursor-pointer flex gap-2 items-center"
              onClick={handleLogout}
            >
              <LogOut size={20} />
              Logout
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
