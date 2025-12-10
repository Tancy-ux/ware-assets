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
      <div className="flex items-center justify-between p-6 md:px-12">
        <Link
          to="/"
          className="text-green tracking-tight font-bold text-xl md:text-4xl"
        >
          Ware Innovations
        </Link>
        <div className="flex gap-4 md:gap-8 text-md font-semibold md:text-xl">
          {/* <Link to="/#assets">Downloads</Link>
          <span> | </span> 
          <Link to="/about">About Ware</Link>
          <span> | </span>
          */}
          {!isAuth && <Link to="/login">Login</Link>}
          {isAuth && (
            <button
              className="cursor-pointer flex gap-1 lg:gap-2 items-center text-sm lg:text-lg"
              onClick={handleLogout}
            >
              <LogOut size={18} />
              Logout
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
