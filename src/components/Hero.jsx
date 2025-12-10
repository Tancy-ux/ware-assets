import { Brush, Images, TypeOutline } from "lucide-react";
import Card from "./Card";

export default function Hero() {
  return (
    <div className="bg-green text-white">
      <div className="flex flex-col items-center justify-center py-16 lg:py-24 gap-3 lg:gap-6 px-6">
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
          href="#home"
          className="btn btn-outline btn-sm rounded-full mt-1 lg:mb-4"
        >
          All Assets
        </a>

        {/* CARDS */}
        <div className="flex flex-col lg:flex-row gap-1 lg:gap-8 w-full justify-center">
          <a href="#logos" className="w-full lg:w-auto">
            <Card text="Logos" logo={<Images size={36} />} />
          </a>
          <a href="#colors" className="w-full lg:w-auto">
            <Card text="Colors" logo={<Brush size={36} />} />
          </a>
          <a href="#fonts" className="w-full lg:w-auto">
            <Card text="Fonts" logo={<TypeOutline size={36} />} />
          </a>
        </div>

        {/* DESCRIPTION */}
        <div className="text-sm md:text-lg w-full lg:w-[60%] text-center font-semibold pt-5">
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
