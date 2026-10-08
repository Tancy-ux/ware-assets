// One line of a product's dimensions, written the same way every time:
//   - inch marks become "in":    3.4"  ->  3.4 in
//   - a space before the unit:   0.1in ->  0.1 in, 254mm -> 254 mm
//   - the unit once per size:    4.2in x 4.2in x 2.3in -> 4.2 x 4.2 x 2.3 in
//   - " / " between the two, "x" with a space each side
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
    .replace(/(\d)\s*(inches|inch|in|cm|mm)\b/gi, (_, d, u) =>
      `${d} ${u.toLowerCase().startsWith("in") ? "in" : u.toLowerCase()}`)
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
