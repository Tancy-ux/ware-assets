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
      <div className="bg-white text-gray flex flex-col items-center justify-center py-10 lg:pt-20 gap-10 px-4">
        <h1 className="text-3xl lg:text-5xl font-bold text-center">
          Brand Logos
        </h1>

        {logoText.map((text, index) => {
          const logo = logos[index];
          const textForLogo = textForLogos[index];

          return (
            <div
              key={index}
              className="flex flex-col lg:flex-row items-center 
                         glass w-full lg:w-auto p-5 lg:pr-20 gap-8 lg:gap-15"
            >
              {/* DISPLAY IMAGE */}
              <img
                src={logo.display}
                loading="lazy"
                alt={text}
                className="w-auto h-40 lg:h-80 ml-2 lg:m-12"
              />

              <div className="flex flex-col items-center lg:items-start gap-2 text-center lg:text-left">
                <p className="text-xl lg:text-3xl font-bold">{text}</p>
                <p className="text-lg lg:text-xl italic">{textForLogo}</p>

                <div className="flex gap-3 pt-4">
                  <button
                    onClick={() =>
                      downloadFile(
                        logo.transparent,
                        `${text.toLowerCase().replace(/ /g, "_")}.png`
                      )
                    }
                    className="flex items-center gap-1 border border-gray-400 py-1 px-3 rounded-lg"
                  >
                    <Download size={16} />
                    PNG
                  </button>

                  <button
                    onClick={() =>
                      downloadFile(
                        logo.display,
                        `${text.toLowerCase().replace(/ /g, "_")}.jpg`
                      )
                    }
                    className="flex items-center gap-1 border border-gray-400 py-1 px-3 rounded-lg"
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
  );
}
