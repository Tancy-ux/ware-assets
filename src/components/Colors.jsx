import { Copy } from "lucide-react";
import { toast } from "react-toastify";

export default function Colors() {
  const text = [
    "Ware's Light Cream",
    "Ware's Burnt Orange",
    "Ware's Light Green",
    "Ware's Dark Green",
    "Ware's Off-white",
    "Ware's Black",
  ];
  const hexcodes = ["fae3ce", "bf5e35", "a8ab65", "505e37", "e8e8e1", "565656"];
  const copy = async (hex) => {
    const text = `#${hex}`;

    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied!");
    } catch (error) {
      toast.error("Failed to copy!");
      console.error(error);
    }
  };
  return (
    <div id="colors" className="bg-[#eef2e8] text-gray">
      <div className="flex flex-col items-center justify-center py-25 gap-5">
        <div className="flex flex-col items-center">
          <p className="text-xl md:text-4xl font-bold pb-10">Brand Colors</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-5 md:gap-8 w-full max-w-6xl mx-auto">
          {text.map((text, index) => {
            const hex = hexcodes[index];

            return (
              <div
                key={index}
                className="group flex flex-col items-center gap-3"
              >
                {/* Color Tile */}
                <div
                  className="relative w-full aspect-square rounded-2xl shadow-md flex items-center justify-center cursor-pointer overflow-hidden"
                  style={{ backgroundColor: `#${hex}` }}
                  onClick={() => copy(hex)}
                >
                  <div className="opacity-0 group-hover:opacity-100 transition bg-white/30 backdrop-blur-md p-3 rounded-full">
                    <Copy size={20} />
                  </div>
                </div>

                {/* Color Name */}
                <div className="text-sm md:text-base font-semibold text-center">
                  {text}
                </div>

                {/* Hex */}
                <div className="relative group">
                  <button
                    onClick={() => copy(hex)}
                    className="text-xs tracking-widest text-gray-600 hover:text-black transition cursor-pointer"
                  >
                    #{hex}
                  </button>

                  <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[10px] px-2 py-1 rounded bg-[#565656] text-white opacity-0 group-hover:opacity-100 transition whitespace-nowrap">
                    Click to copy
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
