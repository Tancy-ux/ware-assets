export default function SectionHeader({ title, subtitle }) {
  return (
    <div className="flex items-end justify-between gap-4 border-b border-black/10 pb-3 mb-6">
      <h2 className="text-lg sm:text-xl font-semibold text-gray-800">
        {title}
      </h2>
      {subtitle && (
        <span className="text-xs text-gray-400 whitespace-nowrap">
          {subtitle}
        </span>
      )}
    </div>
  );
}
