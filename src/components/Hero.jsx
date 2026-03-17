import { Brush, Images, TypeOutline, Files } from "lucide-react";
import Card from "./Card";

export default function Hero() {
  return (
    <div className="bg-green text-white">
      <div className="flex flex-col items-center justify-center py-10 xl:py-20 gap-3 xl:gap-6 px-6">
        {/* LOGO + TAGLINE */}
        <div className="flex flex-col items-center gap-y-1">
          <img
            src="./ware-white-transparent.png"
            alt="ware"
            className="w-32 md:w-40"
          />
          <p className="text-base md:text-2xl text-center">
            Brand Guidelines & Asset Library
          </p>
        </div>

        {/* BUTTON */}
        <a
          href="/ware-assets/#assets"
          className="btn btn-outline btn-sm rounded-full mt-1 lg:mb-4"
        >
          All Assets
        </a>

        {/* CARDS */}
        <div className="max-w-4xl mx-auto grid grid-cols-4 gap-3 md:gap-6 pt-2">
          <a
            href="/ware-assets/#assets"
            className="group bg-[#eef2e8] border border-gray-200 rounded-xl md:rounded-2xl p-4 md:p-6 flex flex-col items-center justify-center text-center hover:shadow-md active:scale-95 transition-all duration-200"
          >
            <Files className="w-5 h-5 md:w-7 md:h-7 text-gray-600 mb-1 md:mb-2 group-hover:text-black transition" />
            <span className="font-medium text-[10px] md:text-base text-gray-800">
              Assets
            </span>
          </a>

          <a
            href="/ware-assets/#logos"
            className="group bg-[#eef2e8] border border-gray-200 rounded-xl md:rounded-2xl p-4 md:p-6 flex flex-col items-center justify-center text-center hover:shadow-md active:scale-95 transition-all duration-200"
          >
            <Images className="w-5 h-5 md:w-7 md:h-7 text-gray-600 mb-1 md:mb-2 group-hover:text-black transition" />
            <span className="font-medium text-[10px] md:text-base text-gray-800">
              Logos
            </span>
          </a>

          <a
            href="/ware-assets/#colors"
            className="group bg-[#eef2e8] border border-gray-200 rounded-xl md:rounded-2xl p-4 md:p-6 flex flex-col items-center justify-center text-center hover:shadow-md active:scale-95 transition-all duration-200"
          >
            <Brush className="w-5 h-5 md:w-7 md:h-7 text-gray-600 mb-1 md:mb-2 group-hover:text-black transition" />
            <span className="font-medium text-[10px] md:text-base text-gray-800">
              Colors
            </span>
          </a>

          <a
            href="/ware-assets/#fonts"
            className="group bg-[#eef2e8] border border-gray-200 rounded-xl md:rounded-2xl p-4 md:p-6 flex flex-col items-center justify-center text-center hover:shadow-md active:scale-95 transition-all duration-200"
          >
            <TypeOutline className="w-5 h-5 md:w-7 md:h-7 text-gray-600 mb-1 md:mb-2 group-hover:text-black transition" />
            <span className="font-medium text-[10px] md:text-base text-gray-800">
              Fonts
            </span>
          </a>
        </div>

        {/* DESCRIPTION */}
        <div className="text-sm md:text-lg w-full lg:w-[48%] text-center font-medium tracking-tight px-2 pt-5">
          <p>
            Click. Download. Access Ware's complete brand asset library
            instantly. All logos, fonts, templates, and materials — ready for
            immediate use.
          </p>
        </div>
      </div>
    </div>
  );
}
