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
        <div className="max-w-4xl mx-auto grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 pt-1.5">
          <a
            href="/ware-assets/#assets"
            className="group bg-[#eef2e8] border border-gray-200 rounded-2xl p-6 flex flex-col items-center justify-center text-center shadow-sm hover:shadow-lg transition"
          >
            <Files
              size={32}
              className="text-gray-600 mb-2 group-hover:text-black transition"
            />
            <span className="font-semibold text-xs md:text-lg text-gray-800">
              Assets
            </span>
          </a>

          <a
            href="/ware-assets/#logos"
            className="group bg-[#eef2e8] border border-gray-200 rounded-2xl p-6 flex flex-col items-center justify-center text-center shadow-sm hover:shadow-lg transition"
          >
            <Images
              size={32}
              className="text-gray-600 mb-2 group-hover:text-black transition"
            />
            <span className="font-semibold text-xs md:text-lg text-gray-800">
              Logos
            </span>
          </a>

          <a
            href="/ware-assets/#colors"
            className="group bg-[#eef2e8] border border-gray-200 rounded-2xl p-6 flex flex-col items-center justify-center text-center shadow-sm hover:shadow-lg transition"
          >
            <Brush
              size={32}
              className="text-gray-600 mb-2 group-hover:text-black transition"
            />
            <span className="font-semibold text-xs md:text-lg text-gray-800">
              Colors
            </span>
          </a>

          <a
            href="/ware-assets/#fonts"
            className="group bg-[#eef2e8] border border-gray-200 rounded-2xl p-6 flex flex-col items-center justify-center text-center shadow-sm hover:shadow-lg transition"
          >
            <TypeOutline
              size={32}
              className="text-gray-600 mb-2 group-hover:text-black transition"
            />
            <span className="font-semibold text-xs md:text-lg text-gray-800">
              Fonts
            </span>
          </a>
        </div>

        {/* DESCRIPTION */}
        <div className="text-sm md:text-lg w-full lg:w-[48%] text-center font-semibold pt-5">
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
