import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

// Sortable tables on the Chats page (Contacts, Products): a column heading
// you tap to sort by it, and again to flip the order.

export const SortHead = ({ by, label, sort, setSort, className }) => {
  const on = sort.by === by;
  const Icon = on ? (sort.desc ? ArrowDown : ArrowUp) : ArrowUpDown;
  return (
    <th
      className={className}
      aria-sort={on ? (sort.desc ? "descending" : "ascending") : "none"}
    >
      <button
        type="button"
        className={`chats-sort${on ? " chats-sort-on" : ""}`}
        onClick={() => setSort({ by, desc: on ? !sort.desc : true })}
      >
        {label}
        <Icon size={13} />
      </button>
    </th>
  );
};
