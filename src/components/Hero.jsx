import { Brush, Images, TypeOutline } from "lucide-react";
import Card from "./Card";

export default function Hero() {
  return (
    <div className="bg-green text-white">
      <div className="flex flex-col items-center justify-center py-25 gap-5">
        <div className="flex flex-col items-center">
          <img
            src="./ware-white-transparent.png"
            alt="ware"
            className="h-32 w-81"
          />
          <p className="text-xl md:text-2xl ">
            Brand Guidelines & Asset Library
          </p>
        </div>
        <div>Searchbar</div>
        <div>
          <a href="#home" className="btn btn-outline rounded-full">
            All Assets
          </a>
        </div>
        <div className="flex gap-8">
          <a href="#logos">
            <Card text="Logos" logo={<Images size={40} />} />
          </a>
          <a href="#colors">
            <Card text="Colors" logo={<Brush size={40} />} />
          </a>
          <a href="#fonts">
            <Card text="Fonts" logo={<TypeOutline size={40} />} />
          </a>
        </div>
        <div className="text-lg w-[60%] text-center font-semibold pt-5">
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
