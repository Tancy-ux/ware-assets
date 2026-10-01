// Shared by the Chats page's tables (see chatTable.jsx).

// rows sorted by `sort.by`, read with get[sort.by] (numbers or strings).
export const sortRows = (rows, sort, get) =>
  [...rows].sort((a, b) => {
    const x = get[sort.by](a);
    const y = get[sort.by](b);
    const diff =
      typeof x === "number" && typeof y === "number"
        ? x - y
        : String(x ?? "").localeCompare(String(y ?? ""));
    return sort.desc ? -diff : diff;
  });

export const formatDay = (iso) =>
  new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });

export const formatWhen = (iso) =>
  new Date(iso).toLocaleString([], {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

export const rupees = (n) => `₹${Math.round(n).toLocaleString("en-IN")}`;
