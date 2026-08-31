import { Download } from "lucide-react";
import SectionHeader from "./SectionHeader";

export default function Logos() {
  const base = import.meta.env.BASE_URL;

  const logos = [
    {
      name: "Burnt Orange",
      use: "for light background",
      display: `${base}ware.jpg`,
      transparent: `${base}ware-transparent.png`,
    },
    {
      name: "White Logo",
      use: "for dark background",
      display: `${base}ware-white.jpg`,
      transparent: `${base}ware-white-transparent.png`,
    },
    {
      name: "Atelier Logo",
      use: "for light background",
      display: `${base}ware-atelier.jpg`,
      transparent: `${base}ware-atelier-transparent.png`,
    },
    {
      name: "Atelier white",
      use: "for dark background",
      display: `${base}ware-atelier-white.jpg`,
      transparent: `${base}atelier-white-transparent.png`,
    },
  ];

  const downloadFile = async (fileURL, filename) => {
    const response = await fetch(fileURL);
    const blob = await response.blob();
    const blobURL = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = blobURL;
    link.download = filename;
    document.body.appendChild(link);
    link.click();

    document.body.removeChild(link);
    URL.revokeObjectURL(blobURL);
  };

  return (
    <div id="logos" className="bg-[#eef2e8] text-gray py-8 lg:py-10">
      <SectionHeader
        title="Brand logos"
        subtitle="For marketing and press use"
      />

      {/* Logo Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
        {logos.map((logo) => (
          <div
            key={logo.name}
            className="bg-white border border-black/5 rounded-xl shadow-sm hover:shadow-md transition flex flex-col items-center text-center gap-3 p-4 sm:p-6"
          >
            {/* Logo Display */}
            <div className="flex items-center justify-center h-16 sm:h-20">
              <img
                src={logo.display}
                loading="lazy"
                alt={logo.name}
                className="max-h-full w-auto object-contain"
              />
            </div>

            {/* Logo Info */}
            <div>
              <h3 className="text-sm sm:text-base font-semibold">
                {logo.name}
              </h3>
              <p className="text-gray-600 italic text-xs mt-0.5">
                {logo.use}
              </p>
            </div>

            {/* Download Buttons */}
            <div className="flex gap-2 w-full">
              <button
                onClick={() =>
                  downloadFile(
                    logo.transparent,
                    `${logo.name.toLowerCase().replace(/ /g, "_")}.png`,
                  )
                }
                className="flex-1 flex items-center justify-center gap-1.5 bg-[#2e4034] text-white px-2 py-1.5 rounded-md text-xs hover:bg-[#243329] transition"
              >
                <Download size={13} />
                PNG
              </button>

              <button
                onClick={() =>
                  downloadFile(
                    logo.display,
                    `${logo.name.toLowerCase().replace(/ /g, "_")}.jpg`,
                  )
                }
                className="flex-1 flex items-center justify-center gap-1.5 border border-gray-300 px-2 py-1.5 rounded-md text-xs hover:bg-gray-50 transition"
              >
                <Download size={13} />
                JPG
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
