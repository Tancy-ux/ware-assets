import { Download } from "lucide-react";

export default function Logos() {
  const logoText = [
    "Burnt Orange",
    "White Logo",
    "Atelier Logo",
    "Atelier white",
  ];

  const textForLogos = [
    "for light background",
    "for dark background",
    "for light background",
    "for dark background",
  ];

  const base = import.meta.env.BASE_URL;
  const logos = [
    { display: `${base}ware.jpg`, transparent: `${base}ware-transparent.png` },
    {
      display: `${base}ware-white.jpg`,
      transparent: `${base}ware-white-transparent.png`,
    },
    {
      display: `${base}ware-atelier.jpg`,
      transparent: `${base}ware-atelier-transparent.png`,
    },
    {
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
    <div id="logos">
      <div className="bg-[#eef2e8] text-gray py-16 lg:py-24 px-4">
        {/* Section Title */}
        <div className="max-w-6xl mx-auto text-center mb-10">
          <h1 className="text-2xl lg:text-4xl font-bold tracking-tight">
            Brand Logos
          </h1>
          <p className="text-gray-600 text-xs md:text-lg mt-3">
            Download official Ware brand logos for marketing and press use.
          </p>
        </div>

        {/* Logo Cards */}
        <div className="max-w-6xl mx-auto grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
          {logoText.map((text, index) => {
            const logo = logos[index];
            const textForLogo = textForLogos[index];

            return (
              <div
                key={index}
                className="bg-white/60 backdrop-blur-md border border-white/40 rounded-2xl shadow-sm hover:shadow-lg transition flex flex-col items-center text-center gap-3 p-4 sm:p-6"
              >
                {/* Logo Display */}
                <div className="flex items-center justify-center h-16 sm:h-20">
                  <img
                    src={logo.display}
                    loading="lazy"
                    alt={text}
                    className="max-h-full w-auto object-contain"
                  />
                </div>

                {/* Logo Info */}
                <div>
                  <h2 className="text-sm sm:text-base font-semibold">
                    {text}
                  </h2>
                  <p className="text-gray-600 italic text-xs mt-0.5">
                    {textForLogo}
                  </p>
                </div>

                {/* Download Buttons */}
                <div className="flex gap-2 w-full">
                  <button
                    onClick={() =>
                      downloadFile(
                        logo.transparent,
                        `${text.toLowerCase().replace(/ /g, "_")}.png`,
                      )
                    }
                    className="flex-1 flex items-center justify-center gap-1.5 bg-gray-800 text-white px-2 py-1.5 rounded-lg text-xs hover:bg-black transition"
                  >
                    <Download size={13} />
                    PNG
                  </button>

                  <button
                    onClick={() =>
                      downloadFile(
                        logo.display,
                        `${text.toLowerCase().replace(/ /g, "_")}.jpg`,
                      )
                    }
                    className="flex-1 flex items-center justify-center gap-1.5 border border-gray-300 px-2 py-1.5 rounded-lg text-xs hover:bg-gray-100 transition"
                  >
                    <Download size={13} />
                    JPG
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
