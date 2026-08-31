import SectionHeader from "./SectionHeader";

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

export default function Fonts() {
  return (
    <div id="fonts" className="py-8 lg:py-10 bg-[#eef2e8] text-gray">
      <SectionHeader
        title="Brand fonts"
        subtitle="One for interfaces, one for personality"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {fonts.map((font, index) => (
          <div
            key={index}
            className="flex flex-col gap-3 p-6 bg-white border border-black/5 rounded-xl shadow-sm"
          >
            {/* FONT NAME */}
            <h3 className={`uppercase text-2xl sm:text-3xl ${font.class}`}>
              {font.name}
            </h3>

            {/* DESCRIPTION */}
            <div>
              <p className="font-medium text-sm text-gray-800 pb-1">
                {font.style}
              </p>
              <p className="text-gray-500 text-sm">{font.usage}</p>
            </div>

            {/* BODY PREVIEW */}
            {font.body && (
              <div className="flex items-center gap-4 text-sm text-gray-600">
                <p className="font-semibold">Headings</p>
                <p className="font-medium">{font.body}</p>
                <p className="italic">Italic text</p>
              </div>
            )}

            <a
              href={font.link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium border border-gray-300 hover:bg-gray-50 rounded-md px-3 py-1.5 w-fit mt-auto transition"
            >
              Get it here
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
