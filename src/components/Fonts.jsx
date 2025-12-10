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
      className="py-20 px-6 bg-white text-gray flex flex-col items-center gap-12"
    >
      <h1 className="text-5xl font-bold text-center pb-10">Brand Fonts</h1>
      <div className="flex flex-col gap-8">
        {fonts.map((font, index) => (
          <div
            key={index}
            className="flex flex-col md:flex-row w-full items-start md:items-center justify-around gap-4 py-16 px-5 glass rounded-2xl"
          >
            <h2
              className={`uppercase w-[50%] text-center text-3xl md:text-5xl ${font.class}`}
            >
              {font.name}
            </h2>

            <div className="flex flex-col md:items-start w-[50%] gap-4 md:gap-6">
              <div>
                <p className="font-semibold text-xl pb-3">{font.style}</p>
                <p className="text-gray-700  w-[80%]">{font.usage}</p>
              </div>
              {font.body && (
                <div className="flex justify-between items-center gap-10">
                  <p className="font-bold text-3xl">Headings</p>
                  <p className="font-medium">{font.body}</p>
                  <p className="italic">Body Text Italic</p>
                </div>
              )}
              <a
                href={font.link}
                target="_blank"
                className="btn btn-outline btn-neutral"
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
