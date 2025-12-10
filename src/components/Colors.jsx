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
    }
  };
  return (
    <div id="colors" className="bg-white text-gray">
      <div className="flex flex-col items-center justify-center py-25 gap-5">
        <div className="flex flex-col items-center">
          <p className="text-xl md:text-4xl font-bold pb-10">Brand Colors</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-8">
          {text.map((text, index) => {
            const hex = hexcodes[index];
            return (
              <div
                key={index}
                className="glass px-10 py-8 flex gap-4 flex-col items-center"
              >
                <div className="text-xl font-semibold">{text}</div>
                <div
                  className="w-64 h-60 rounded-2xl flex items-center justify-center text-white"
                  style={{ backgroundColor: `#${hexcodes[index]}` }}
                >
                  <button
                    className="cursor-pointer glass p-3 rounded-full"
                    onClick={() => copy(hex)}
                  >
                    <Copy size={24} />
                  </button>
                </div>
                <button
                  className="btn btn-ghost tracking-widest uppercase bg-gray-100 hover:bg-[#565656] hover:text-white w-full"
                  onClick={() => copy(hex)}
                >
                  #{hexcodes[index]}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
