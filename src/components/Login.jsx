import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { supabase } from "./supabase";

// Signs in with a team account from Supabase (Authentication > Users). The
// database only lets signed-in accounts change FAQs, guidelines and assets
// (scripts/supabase-security.sql); the "auth" flag just drives the UI.
export default function Login() {
  const navigate = useNavigate();

  const [input, setInput] = useState("");
  const [pass, setPass] = useState("");
  const [signingIn, setSigningIn] = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    setSigningIn(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: input.trim(),
      password: pass,
    });
    setSigningIn(false);
    if (error) {
      toast.error("Wrong email or password. Try again!");
      return;
    }
    localStorage.setItem("auth", "true");
    navigate("/");
  }
  return (
    <div className="pt-16 sm:pt-32 md:pt-60 px-4 flex items-center justify-center bg-[#eef2e8] relative overflow-hidden">
      <div className="absolute w-[90vw] max-w-[600px] h-[400px] sm:h-[500px] bg-[#eef2e8]/60 blur-[180px] rounded-full"></div>

      <div className="relative w-full max-w-xl p-6 sm:p-10 rounded-3xl bg-[#eef2e8]/20 backdrop-blur-3xl border border-white/60 shadow-[0_0_60px_rgba(0,0,0,0.08)]">
        <div className="absolute inset-0 rounded-3xl bg-linear-to-br from-white/70 to-transparent opacity-40 pointer-events-none"></div>

        <h1 className="text-2xl sm:text-3xl font-semibold text-green text-center mb-8 sm:mb-10">
          Access Ware brand assets
        </h1>
        <form className="space-y-6" onSubmit={handleLogin}>
          <div>
            <label className="block text-gray-700 mb-1">Email</label>
            <input
              type="email"
              name="email"
              autoComplete="username"
              required
              className="w-full p-3 rounded-xl bg-[#eef2e8]/40 border border-white/80 text-gray-800 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-black/10"
              placeholder="you@example.com"
              onChange={(e) => setInput(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-gray-700 mb-1">Password</label>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              className="w-full p-3 rounded-xl bg-[#eef2e8]/40 border border-white/80 text-gray-800 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-black/10"
              placeholder="••••••••"
              onChange={(e) => setPass(e.target.value)}
            />
          </div>
          <button
            type="submit"
            disabled={signingIn}
            className="w-full p-3 rounded-lg bg-green text-white font-semibold shadow-md hover:bg-green-950 transition cursor-pointer"
          >
            {signingIn ? "Signing in..." : "Login"}
          </button>
        </form>
      </div>
    </div>
  );
}
