export default function Card({ text, logo, name }) {
  return (
    <div className="glass border rounded-2xl px-25 py-16 mt-5 flex flex-col items-center">
      <div className="glass p-3">{logo}</div>
      <div className="pt-5 uppercase font-semibold">{text}</div>
      <div>{name}</div>
    </div>
  );
}
