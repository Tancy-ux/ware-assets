import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

export default function Login() {
  const navigate = useNavigate();
  const username = "ware-members";
  const PASSWORD = "work-play-hard";

  const [input, setInput] = useState("");
  const [pass, setPass] = useState("");

  function handleLogin(e) {
    e.preventDefault();
    if (input === username && pass === PASSWORD) {
      localStorage.setItem("auth", "true");
      navigate("/");
    } else {
      toast.error("Wrong username or password. Try again!");
    }
  }
  return (
    <div className="pt-60 flex items-center justify-center bg-white relative">
      <div className="absolute w-[600px] h-[500px] bg-white/60 blur-[180px] rounded-full"></div>

      <div className="relative w-full max-w-xl p-10 rounded-3xl bg-white/20 backdrop-blur-3xl border border-white/60 shadow-[0_0_60px_rgba(0,0,0,0.08)]">
        <div className="absolute inset-0 rounded-3xl bg-linear-to-br from-white/70 to-transparent opacity-40 pointer-events-none"></div>

        <h1 className="text-3xl font-semibold text-green text-center mb-10">
          Access Ware brand assets
        </h1>
        <form className="space-y-6" onSubmit={handleLogin}>
          <div>
            <label className="block text-gray-700 mb-1">Username</label>
            <input
              type="text"
              className="w-full p-3 rounded-xl bg-white/40 border border-white/80 text-gray-800 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-black/10"
              placeholder="you@example.com"
              onChange={(e) => setInput(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-gray-700 mb-1">Password</label>
            <input
              type="text"
              className="w-full p-3 rounded-xl bg-white/40 border border-white/80 text-gray-800 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-black/10"
              placeholder="••••••••"
              onChange={(e) => setPass(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="w-full p-3 rounded-lg bg-green text-white font-semibold shadow-md hover:bg-green-950 transition cursor-pointer"
          >
            Login
          </button>
        </form>
      </div>
    </div>
  );
}
