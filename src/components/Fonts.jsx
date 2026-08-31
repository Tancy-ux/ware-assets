export default function Fonts() {
  const fonts = [
    {
      name: "Montserrat",
      class: "font-montserrat",
      style: "Sans-serif, modern, clean",
      link: "https://fonts.google.com/specimen/Montserrat",
      body: "Body Text",
      usage:
        "Used in UI/UX for web and mobile apps because it’s highly readable and versatile. Works well for headings and body text in digital designs.",
    },
    {
      name: "Sheila Crayons",
      class: "font-sheila",
      style: "Handwritten, playful",
      link: "https://dl.dafont.com/dl/?f=sheila_crayon",
      usage:
        "Used in graphic design, especially for posters, invites. Adds a personal, fun, or informal touch.",
    },
  ];

  return (
    <div
      id="fonts"
      className="py-16 lg:py-20 px-4 bg-[#eef2e8] text-gray flex flex-col items-center gap-12"
    >
      <h1 className="text-2xl md:text-4xl font-bold text-center">
        Brand Fonts
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-6xl">
        {fonts.map((font, index) => (
          <div
            key={index}
            className="flex flex-col gap-4 p-6 glass rounded-2xl"
          >
            {/* FONT NAME */}
            <h2 className={`uppercase text-3xl sm:text-4xl ${font.class}`}>
              {font.name}
            </h2>

            {/* DESCRIPTION */}
            <div>
              <p className="font-semibold text-lg pb-1">{font.style}</p>
              <p className="text-gray-700 text-sm">{font.usage}</p>
            </div>

            {/* BODY PREVIEW */}
            {font.body && (
              <div className="flex items-center gap-4 text-sm">
                <p className="font-bold text-lg">Headings</p>
                <p className="font-medium">{font.body}</p>
                <p className="italic">Italic text</p>
              </div>
            )}

            <a
              href={font.link}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-outline btn-neutral btn-sm w-fit mt-auto"
            >
              Get it here
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
