import { Copy } from "lucide-react";
import { toast } from "react-toastify";
import SectionHeader from "./SectionHeader";

const colors = [
  { name: "Ware's Light Cream", hex: "fae3ce", dark: false },
  { name: "Ware's Burnt Orange", hex: "bf5e35", dark: true },
  { name: "Ware's Light Green", hex: "a8ab65", dark: false },
  { name: "Ware's Dark Green", hex: "505e37", dark: true },
  { name: "Ware's Off-white", hex: "e8e8e1", dark: false },
  { name: "Ware's Black", hex: "565656", dark: true },
];

export default function Colors() {
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
    <div id="colors" className="bg-[#eef2e8] text-gray py-8 lg:py-10">
      <SectionHeader
        title="Brand colors"
        subtitle="Click a swatch to copy the hex"
      />

      <div className="flex flex-col sm:flex-row rounded-xl border border-black/5 shadow-sm overflow-hidden">
        {colors.map(({ name, hex, dark }) => (
          <button
            key={hex}
            type="button"
            onClick={() => copy(hex)}
            style={{ backgroundColor: `#${hex}` }}
            className={`group flex-1 flex flex-col justify-end items-start gap-0.5 text-left h-28 sm:h-40 px-4 py-3.5 transition ${
              dark ? "text-white/90" : "text-black/70"
            }`}
          >
            <span
              className={`self-end opacity-0 group-hover:opacity-100 transition p-1.5 rounded-full mb-auto ${
                dark ? "bg-white/20" : "bg-black/10"
              }`}
            >
              <Copy size={13} />
            </span>
            <span className="text-xs sm:text-sm font-medium">{name}</span>
            <span className="text-[11px] font-mono opacity-75">#{hex}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
