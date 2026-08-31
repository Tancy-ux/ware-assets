import { useState } from "react";
import Fonts from "../components/Fonts";
import Logos from "../components/Logos";
import Colors from "../components/Colors";
import Footer from "../components/Footer";
import Assets from "../components/Assets";

const sections = [
  { id: "assets", label: "Assets" },
  { id: "colors", label: "Colors" },
  { id: "fonts", label: "Fonts" },
  { id: "logos", label: "Logos" },
];

export default function HomePage() {
  const [active, setActive] = useState("assets");

  const jumpTo = (id) => {
    setActive(id);
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div id="home" className="bg-[#eef2e8]">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row">
        <aside className="shrink-0 md:w-48 md:sticky md:top-14 md:self-start px-4 md:px-5 py-3 md:py-9 border-b md:border-b-0 md:border-r border-black/5">
          <p className="hidden md:block text-[11px] font-medium uppercase tracking-wide text-gray-400 mb-3">
            On this page
          </p>
          <nav className="flex md:flex-col gap-1.5 overflow-x-auto md:overflow-visible">
            {sections.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => jumpTo(s.id)}
                className={`flex items-center gap-2 whitespace-nowrap text-sm font-medium px-3 py-2 rounded-md transition ${
                  active === s.id
                    ? "bg-light text-brown"
                    : "text-gray-600 hover:bg-white"
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current opacity-50 shrink-0" />
                {s.label}
              </button>
            ))}
          </nav>
        </aside>

        <main className="flex-1 min-w-0 px-4 md:px-8 py-6 md:py-9">
          <Assets />
          <Colors />
          <Fonts />
          <Logos />

          <Footer />
        </main>
      </div>
    </div>
  );
}
