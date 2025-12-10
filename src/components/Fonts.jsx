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
      className="py-10 lg:py-20 px-4 bg-white text-gray flex flex-col items-center gap-12"
    >
      <h1 className="text-3xl md:text-5xl font-bold text-center">
        Brand Fonts
      </h1>

      <div className="flex flex-col gap-10 w-full max-w-6xl">
        {fonts.map((font, index) => (
          <div
            key={index}
            className="flex flex-col md:flex-row w-full items-center gap-10 px-16 py-8 glass rounded-2xl"
          >
            {/* FONT NAME */}
            <h2
              className={`uppercase text-center md:text-left text-3xl md:text-5xl w-full md:w-1/2 ${font.class}`}
            >
              {font.name}
            </h2>

            {/* DESCRIPTION */}
            <div className="flex flex-col gap-5 w-full md:w-1/2">
              <div>
                <p className="font-semibold text-xl pb-2">{font.style}</p>
                <p className="text-gray-700">{font.usage}</p>
              </div>

              {/* BODY PREVIEW */}
              {font.body && (
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                  <p className="font-bold text-2xl sm:text-3xl">Headings</p>
                  <p className="font-medium">{font.body}</p>
                  <p className="italic">Italic text</p>
                </div>
              )}

              <a
                href={font.link}
                target="_blank"
                className="btn btn-outline btn-neutral w-fit"
              >
                Get it here
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
