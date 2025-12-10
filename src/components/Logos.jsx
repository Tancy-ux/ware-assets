import { Download } from "lucide-react";

export default function Logos() {
  const logoText = [
    "Brown Logo",
    "White Logo",
    "Atelier Logo",
    "Atelier white",
  ];

  const textForLogos = [
    "For light background",
    "For dark background",
    "For light background",
    "For dark background",
  ];

  // display = JPG, transparent = PNG
  const logos = [
    { display: "/ware.jpg", transparent: "/ware-transparent.png" },
    { display: "/ware-white.jpg", transparent: "/ware-white-transparent.png" },
    {
      display: "/ware-atelier.jpg",
      transparent: "/ware-atelier-transparent.png",
    },
    {
      display: "/ware-atelier-white.jpg",
      transparent: "/atelier-white-transparent.png",
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
      <div className="bg-white text-gray flex flex-col items-center justify-center py-20 gap-5">
        <h1 className="text-5xl font-bold text-center pb-15">Brand Logos</h1>

        {logoText.map((text, index) => {
          const logo = logos[index];
          const textForLogo = textForLogos[index];

          return (
            <div
              key={index}
              className="flex items-center glass pl-10 pr-40 gap-15"
            >
              {/* DISPLAY IMAGE */}
              <img
                src={logo.display}
                alt={text}
                className="w-auto h-80 m-12 ml-5"
              />

              <div className="flex flex-col items-start gap-2">
                <p className="text-2xl md:text-4xl font-bold">{text}</p>
                <p className="text-lg md:text-xl font-semibold">
                  {textForLogo}
                </p>

                <div className="flex gap-2 pt-10">
                  {/* PNG BUTTON — transparent PNG */}
                  <button
                    onClick={() =>
                      downloadFile(
                        logo.transparent,
                        `${text.toLowerCase().replace(/ /g, "_")}.png`
                      )
                    }
                    className="flex items-center gap-0.5 border border-gray-400 py-1 px-2 rounded-md"
                  >
                    <Download size={16} />
                    PNG
                  </button>

                  {/* JPG BUTTON — use the real JPG file, NOT replace */}
                  <button
                    onClick={() =>
                      downloadFile(
                        logo.display,
                        `${text.toLowerCase().replace(/ /g, "_")}.jpg`
                      )
                    }
                    className="flex items-center gap-0.5 border border-gray-400 py-1 px-2 rounded-md"
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
