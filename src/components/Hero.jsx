import { Brush, Images, TypeOutline, Files } from "lucide-react";
import Card from "./Card";

export default function Hero() {
  return (
    <div className="bg-green text-white">
      <div className="flex flex-col items-center justify-center py-14 md:py-20 gap-8 px-6">
        {/* LOGO + TAGLINE */}
        <div className="flex flex-col items-center gap-2">
          <img
            src="./ware-white-transparent.png"
            alt="ware"
            className="w-28 md:w-36"
          />
          <p className="text-sm md:text-xl text-center text-white/80">
            Brand Guidelines & Asset Library
          </p>
        </div>

        {/* CARDS */}
        <div className="max-w-4xl w-full grid grid-cols-4 gap-3 md:gap-6">
          {[
            { icon: Files, label: "Assets", link: "#assets" },
            { icon: Images, label: "Logos", link: "#logos" },
            { icon: Brush, label: "Colors", link: "#colors" },
            { icon: TypeOutline, label: "Fonts", link: "#fonts" },
          ].map(({ icon: Icon, label, link }) => (
            <a
              key={label}
              href={`/ware-assets/${link}`}
              className="group bg-white/10 border border-white/20 rounded-xl md:rounded-2xl p-4 md:p-6 flex flex-col items-center justify-center text-center backdrop-blur-md hover:bg-white/20 transition-all duration-200 active:scale-95"
            >
              <Icon className="w-5 h-5 md:w-7 md:h-7 text-white/80 mb-1 md:mb-2 group-hover:text-white transition" />
              <span className="font-medium text-[10px] md:text-sm text-white">
                {label}
              </span>
            </a>
          ))}
        </div>

        {/* DESCRIPTION */}
        <p className="text-xs md:text-base max-w-xl text-center text-white/70 leading-relaxed">
          Access Ware's complete brand asset library — logos, fonts, templates,
          and materials, all in one place.
        </p>
      </div>
    </div>
  );
}
