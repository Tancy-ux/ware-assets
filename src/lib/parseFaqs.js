// Shared Q&A extraction logic used both by the build-time doc sync
// (scripts/build-faqs.mjs, Node) and the in-browser "upload a document"
// feature (src/components/UploadFaqForm.jsx). Pure functions only — no
// filesystem or network access — so the same code runs in both places.

// Categories that hold internal/team/chatbot-training content rather than
// customer-facing answers, and should be shown separately in the UI.
export const INTERNAL_CATEGORY_PATTERN = /chatbot|internal|team note|tech note/i;

// Tracks the section a paragraph falls under, e.g. "2. Materials, Safety &
// Care" -> category "Materials, Safety & Care". A numbered paragraph counts
// as a section header only when it does NOT end in "?" (numbered questions
// are handled separately by parseNumberedFaq).
export function computeCategories(paragraphs, fallback) {
  const categories = [];
  let current = fallback;

  for (const para of paragraphs) {
    const headerMatch = para.match(/^\d{1,3}[.)]\s*(.+)$/);
    if (headerMatch && !/\?\s*$/.test(para) && para.length < 80) {
      current = headerMatch[1].trim();
    }
    categories.push(current);
  }
  return categories;
}

// Pattern A: "1. Question text ending in a question mark?" as its own
// paragraph, followed by one or more paragraphs of answer text until the
// next numbered question.
export function parseNumberedFaq(paragraphs, categories, source) {
  const faqs = [];
  let current = null;

  paragraphs.forEach((para, i) => {
    const match = para.match(/^\d{1,3}[.)]\s*(.+\?)\s*$/);
    if (match) {
      if (current && current.answer.length) faqs.push(current);
      current = { question: match[1].trim(), answer: [], source, category: categories[i] };
    } else if (current) {
      current.answer.push(para);
    }
  });
  if (current && current.answer.length) faqs.push(current);

  return faqs.map((f) => ({ ...f, answer: f.answer.join("\n\n") }));
}

// Pattern B: "Q: ... A: ..." on a single paragraph, followed by zero or more
// plain paragraphs (bullet points etc.) that continue the answer until the
// next "Q:" line or the next question-like heading paragraph.
export function parseInlineQA(paragraphs, categories, source) {
  const faqs = [];
  let current = null;

  const isHeading = (para) => /\?\s*$/.test(para) && para.length < 150;

  paragraphs.forEach((para, i) => {
    const match = para.match(/^Q:\s*(.+?)\s*A:\s*(.+)$/);
    if (match) {
      if (current) faqs.push(current);
      current = { question: match[1].trim(), answer: [match[2].trim()], source, category: categories[i] };
    } else if (current && !isHeading(para)) {
      current.answer.push(para);
    } else if (current) {
      faqs.push(current);
      current = null;
    }
  });
  if (current) faqs.push(current);

  return faqs.map((f) => ({ ...f, answer: f.answer.join("\n\n") }));
}

// Pattern C: "Q: ..." on its own paragraph, "A: ..." on the next, followed
// by zero or more plain paragraphs continuing the answer until the next
// "Q:" line or a numbered section header ("2. Materials, Safety & Care").
export function parseSeparateQA(paragraphs, categories, source) {
  const faqs = [];
  let current = null;

  paragraphs.forEach((para, i) => {
    if (/^Q:\s*.+\bA:\s*.+/.test(para)) return; // handled by parseInlineQA
    const qMatch = para.match(/^Q:\s*(.+)$/);
    if (qMatch) {
      if (current && current.answer.length) faqs.push(current);
      current = { question: qMatch[1].trim(), answer: [], source, category: categories[i] };
      return;
    }
    const aMatch = para.match(/^A:\s*(.+)$/);
    if (aMatch && current) {
      current.answer.push(aMatch[1].trim());
      return;
    }
    if (current) {
      if (/^\d{1,3}[.)]\s/.test(para)) {
        if (current.answer.length) faqs.push(current);
        current = null;
        return;
      }
      current.answer.push(para);
    }
  });
  if (current && current.answer.length) faqs.push(current);

  return faqs.map((f) => ({ ...f, answer: f.answer.join("\n\n") }));
}

// Pattern D: a short label paragraph ("Return / exchange policy") directly
// followed by a quoted one-line reply ("We accept returns..."), as seen in
// chatbot quick-response banks.
export function parseIntentReply(paragraphs, categories, source) {
  const faqs = [];
  const isQuoted = (p) => /^["\u201C].*["\u201D]$/.test(p);

  for (let i = 0; i < paragraphs.length - 1; i++) {
    const label = paragraphs[i];
    const reply = paragraphs[i + 1];
    if (
      isQuoted(reply) &&
      !isQuoted(label) &&
      label.length < 80 &&
      !/^Q:|^A:/.test(label) &&
      !/^\d{1,3}[.)]\s/.test(label)
    ) {
      faqs.push({
        question: label,
        answer: reply.replace(/^["\u201C]|["\u201D]$/g, "").trim(),
        source,
        category: categories[i],
      });
    }
  }
  return faqs;
}

export function dedupe(faqs) {
  const seen = new Set();
  return faqs.filter((f) => {
    const key = f.question.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Runs every pattern against a paragraph array and returns the deduped
// result. `fallback` is the category assigned to any question that isn't
// under a detected numbered section header.
export function extractFaqsFromParagraphs(paragraphs, fallback, source) {
  const categories = computeCategories(paragraphs, fallback);

  const numbered = parseNumberedFaq(paragraphs, categories, source);
  const inline = parseInlineQA(paragraphs, categories, source);
  const separateQA = parseSeparateQA(paragraphs, categories, source);
  const intentReply = parseIntentReply(paragraphs, categories, source);

  return dedupe([...numbered, ...inline, ...separateQA, ...intentReply]);
}

// Merges entries that are word-for-word identical (the same FAQ appears
// more than once) into a single entry with multiple sources.
export function mergeAcrossFiles(faqs) {
  const byKey = new Map();
  for (const f of faqs) {
    const key = `${f.question.trim().toLowerCase()}||${f.answer.trim().toLowerCase()}`;
    if (byKey.has(key)) {
      byKey.get(key).sources.push(f.source);
    } else {
      byKey.set(key, {
        question: f.question,
        answer: f.answer,
        category: f.category,
        internal: INTERNAL_CATEGORY_PATTERN.test(f.category),
        sources: [f.source],
        docKey: `${f.source}::${f.question.trim().toLowerCase()}`,
      });
    }
  }
  return [...byKey.values()];
}
