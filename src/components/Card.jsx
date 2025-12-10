export default function Card({ text, logo, name }) {
  return (
    <div className="glass border rounded-2xl px-10 py-5 lg:px-25 lg:py-16 mt-4 flex flex-col items-center">
      <div className="glass rounded-2xl p-1.5 lg:p-3">{logo}</div>
      <div className="pt-5 uppercase font-semibold text-xs lg:text-md">
        {text}
      </div>
      <div>{name}</div>
    </div>
  );
}
