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

  const logos = [
    { display: "./ware.jpg", transparent: "./ware-transparent.png" },
    {
      display: "./ware-white.jpg",
      transparent: "./ware-white-transparent.png",
    },
    {
      display: "./ware-atelier.jpg",
      transparent: "./ware-atelier-transparent.png",
    },
    {
      display: "./ware-atelier-white.jpg",
      transparent: "./atelier-white-transparent.png",
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
        <div className="max-w-6xl mx-auto text-center mb-14">
          <h1 className="text-2xl lg:text-4xl font-bold tracking-tight">
            Brand Logos
          </h1>
          <p className="text-gray-600 text-xs md:text-lg mt-3">
            Download official Ware brand logos for marketing and press use.
          </p>
        </div>

        {/* Logo Cards */}
        <div className="max-w-6xl mx-auto flex flex-col gap-12">
          {logoText.map((text, index) => {
            const logo = logos[index];
            const textForLogo = textForLogos[index];

            return (
              <div
                key={index}
                className="bg-white/60 backdrop-blur-md border border-white/40 rounded-3xl shadow-sm hover:shadow-lg transition flex flex-col lg:flex-row items-center gap-8 lg:gap-14 p-6 lg:p-10"
              >
                {/* Logo Display */}
                <div className="flex items-center justify-center rounded-2xl">
                  <img
                    src={logo.display}
                    loading="lazy"
                    alt={text}
                    className="h-32 lg:h-56 w-auto"
                  />
                </div>

                {/* Logo Info */}
                <div className="flex flex-col items-center lg:items-start text-center lg:text-left gap-3">
                  <h2 className="text-xl lg:text-3xl font-semibold">{text}</h2>

                  <p className="text-gray-600 italic text-sm lg:text-base">
                    {textForLogo}
                  </p>

                  {/* Download Buttons */}
                  <div className="flex gap-3 pt-4">
                    <button
                      onClick={() =>
                        downloadFile(
                          logo.transparent,
                          `${text.toLowerCase().replace(/ /g, "_")}.png`,
                        )
                      }
                      className="flex items-center gap-2 bg-gray-800 text-white px-4 py-2 rounded-lg text-sm hover:bg-black transition"
                    >
                      <Download size={16} />
                      PNG
                    </button>

                    <button
                      onClick={() =>
                        downloadFile(
                          logo.display,
                          `${text.toLowerCase().replace(/ /g, "_")}.jpg`,
                        )
                      }
                      className="flex items-center gap-2 border border-gray-300 px-4 py-2 rounded-lg text-sm hover:bg-gray-100 transition"
                    >
                      <Download size={16} />
                      JPG
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
