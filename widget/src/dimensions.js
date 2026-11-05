// One line of a product's dimensions, written the same way every time:
//   - inch marks become "in":    3.4"  ->  3.4 in
//   - a space before the unit:   0.1in ->  0.1 in, 254mm -> 254 mm
//   - the unit once per size:    4.2in x 4.2in x 2.3in -> 4.2 x 4.2 x 2.3 in
//   - " / " between the two, "x" with a space each side
//   - "cms" -> cm
// and when the two figures clearly don't match (a slip in the product's
// details, like "3.4 in / 860 mm"), only the one written first is shown.
// Loose rounding ("2 cm / 1 in") is left alone.

const NUM = String.raw`\d+(?:\.\d+)?`;
// "10 x 8.8 x 6.5 in" (once tidied, the unit is only at the end).
const SIZE = String.raw`(${NUM}(?: x ${NUM})*) (in|cm|mm)\b`;
const PAIR_RE = new RegExp(`${SIZE} / ${SIZE}`, "g");
const CM = { in: 2.54, cm: 1, mm: 0.1 };
// Clearly wrong: more than half again off, and by more than 1.5 cm.
const OFF_RATIO = 1.5;
const OFF_CM = 1.5;

const numbers = (text) => text.split(" x ").map(Number);

// Some figure of one size is clearly not the same as the other's (in cm).
// Different counts ("5 x 5.8 cm / 11 x 8 x 2 in") can't be compared: kept.
const sizesClash = (a, unitA, b, unitB) => {
  const x = numbers(a).map((v) => v * CM[unitA]);
  const y = numbers(b).map((v) => v * CM[unitB]);
  return (
    x.length === y.length &&
    x.some((v, i) => {
      const [lo, hi] = [Math.min(v, y[i]), Math.max(v, y[i])];
      return hi - lo > OFF_CM && hi > lo * OFF_RATIO;
    })
  );
};

export function tidyDimensions(line) {
  const tidy = line
    // 3.4" / 3.4'' / 3.4” / 3.4″ -> 3.4 in
    .replace(/(\d)\s*(?:"|''|”|″)/g, "$1 in")
    // "20. 5" -> "20.5"
    .replace(/(\d)\. (?=\d)/g, "$1.")
    .replace(/(\d)\s*(inches|inch|in|cms?|mm)\b/gi, (_, d, u) =>
      `${d} ${u.toLowerCase().startsWith("in") ? "in" : u.toLowerCase().replace(/s$/, "")}`)
    .replace(/\s*[x×*]\s*(?=\d)/gi, " x ")
    // "4.2 in x 4.2 in x 2.3 in" -> "4.2 x 4.2 x 2.3 in"
    .replace(/(\d) (in|cm|mm) x (?=[\d. x]*? \2\b)/g, "$1 x ")
    .replace(/\s*\/\s*/g, " / ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/\s*\/$/, "");
  return tidy.replace(PAIR_RE, (all, a, unitA, b, unitB) =>
    (unitA === "in") !== (unitB === "in") && sizesClash(a, unitA, b, unitB)
      ? `${a} ${unitA}`
      : all,
  );
}

// A tidied line as { label, sizes }, or null if it has other words on it.
const readSizes = (line) => {
  const found = [...line.matchAll(new RegExp(SIZE, "g"))];
  if (!found.length) return null;
  const rest = found.reduce((text, m) => text.replace(m[0], ""), line.slice(found[0].index));
  if (/[^\s/()]/.test(rest)) return null;
  return {
    label: line.slice(0, found[0].index),
    sizes: found.map((m) => ({ figures: m[1], unit: m[2] })),
  };
};

// One piece's size as "8.5 x 8.5 x 8 cm (3.3 x 3.3 x 3.3 in)": its cm, else
// its mm, then its inches, all as the product page has them. Nothing is
// worked out, so a piece without one simply doesn't show it.
const writeSizes = ({ label, sizes }) => {
  const written = (unit) => sizes.find((s) => s.unit === unit);
  const main = written("cm") ?? written("mm") ?? written("in");
  const inches = written("in");
  const first = `${main.figures} ${main.unit}`;
  return `${label}${main === inches || !inches ? first : `${first} (${inches.figures} in)`}`;
};

// Tidied lines, at most two sizes for each piece. A size on its own line
// in another unit is the same piece's ("3.3 x 3.3 x 3.3 in", then
// "8.5 x 8.5 x 8 cm", then "85 x 85 x 80 mm").
export function twoSizes(lines) {
  const pieces = [];
  for (const line of lines) {
    const piece = readSizes(line);
    const last = pieces.at(-1);
    if (
      piece && !piece.label && last?.sizes &&
      !last.sizes.some((s) => piece.sizes.some((p) => p.unit === s.unit))
    ) {
      last.sizes.push(...piece.sizes);
    } else {
      pieces.push(piece ?? { line });
    }
  }
  return pieces.map((p) => p.line ?? writeSizes(p));
}

// A volume or weight written one way: 125ml, 2.4L, 175g, 1.5kg.
export const tidyAmount = (line) =>
  line
    .replace(/(\d)\s*(?:gms?|grams?)\b/gi, "$1g")
    .replace(/(\d)\s*g\b/gi, "$1g")
    .replace(/(\d)\s*kgs?\b/gi, "$1kg")
    .replace(/(\d)\s*ml\b/gi, "$1ml")
    .replace(/(\d)\s*(?:l|litres?|liters?)\b/gi, "$1L");
