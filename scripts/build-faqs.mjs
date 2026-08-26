import { readdir, readFile, mkdir, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { supabase } from "../src/components/supabase.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ASSETS_DIR = path.join(__dirname, "..", "src", "assets");
const OUT_DIR = path.join(__dirname, "..", "src", "data");
const OUT_FILE = path.join(OUT_DIR, "faqs.json");

// Files in src/assets that aren't FAQ/Q&A documents (SOPs, spreadsheets,
// free-form scripts, etc.) and should be ignored by the FAQ search build.
// Reformat a file as either "1. Question?" + answer paragraphs, or
// "Q: ... A: ..." paragraphs, and remove it from this list to include it.
const SKIP_FILES = new Set([
  "Custom Gifting Process.docx",
  "Ware Gift Studio.xlsx",
  "conversation flow & faq for whatsapp chatbot.docx",
]);

// Fallback category for docs that have no internal section headers of
// their own (a flat numbered FAQ list, front to back).
const FILE_CATEGORY_FALLBACK = {
  "Bulk gifting FAQ (1).docx": "Bulk & Corporate Gifting",
  "Ware Horeca FAQS.docx": "HoReCa — Hotels, Restaurants & Cafés",
  "Ware Retail FAQ.docx": "Retail Shopping",
};

// Categories that hold internal/team/chatbot-training content rather than
// customer-facing answers, and should be shown separately in the UI.
const INTERNAL_CATEGORY_PATTERN = /chatbot|internal|team note|tech note/i;

async function extractParagraphs(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".docx") {
    const { value } = await mammoth.extractRawText({ path: filePath });
    return value
      .split(/\r?\n/)
      .map((p) => p.trim())
      .filter(Boolean);
  }

  if (ext === ".pdf") {
    const buffer = await readFile(filePath);
    const parser = new PDFParse({ data: buffer });
    const { text } = await parser.getText();
    await parser.destroy();
    return text
      .split(/\r?\n/)
      .map((p) => p.trim())
      .filter(Boolean);
  }

  return null;
}

// Tracks the section a paragraph falls under, e.g. "2. Materials, Safety &
// Care" -> category "Materials, Safety & Care". A numbered paragraph counts
// as a section header only when it does NOT end in "?" (numbered questions
// are handled separately by parseNumberedFaq).
function computeCategories(paragraphs, fallback) {
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
function parseNumberedFaq(paragraphs, categories, source) {
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
function parseInlineQA(paragraphs, categories, source) {
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
function parseSeparateQA(paragraphs, categories, source) {
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
function parseIntentReply(paragraphs, categories, source) {
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

function dedupe(faqs) {
  const seen = new Set();
  return faqs.filter((f) => {
    const key = f.question.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Merges entries that are word-for-word identical across files (the same
// FAQ appears in more than one doc) into a single entry with multiple
// sources. Entries with the same question but a different answer are left
// as separate entries, since they may be genuinely different context.
function mergeAcrossFiles(faqs) {
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
        // Identifies this question across rebuilds so re-parsing the same
        // doc never duplicates it or overwrites an edit made on the site.
        // Stays fixed even if the question/answer is later edited on the
        // site; only changes if the source doc's wording itself changes.
        docKey: `${f.source}::${f.question.trim().toLowerCase()}`,
      });
    }
  }
  return [...byKey.values()];
}

// Pushes newly-seen doc questions into Supabase. Uses upsert with
// ignoreDuplicates so a question that already exists there (possibly
// edited on the site since) is left untouched — this only adds rows for
// doc_keys Supabase hasn't seen before.
async function syncToSupabase(faqs) {
  const rows = faqs.map((f) => ({
    question: f.question,
    answer: f.answer,
    category: f.category,
    internal: f.internal,
    doc_key: f.docKey,
  }));

  const { error } = await supabase
    .from("faqs")
    .upsert(rows, { onConflict: "doc_key", ignoreDuplicates: true });

  if (error) throw error;
}

async function buildFaqsForFile(fileName) {
  const filePath = path.join(ASSETS_DIR, fileName);
  const paragraphs = await extractParagraphs(filePath);
  if (!paragraphs) return [];

  const fallback = FILE_CATEGORY_FALLBACK[fileName] ?? "General";
  const categories = computeCategories(paragraphs, fallback);

  const numbered = parseNumberedFaq(paragraphs, categories, fileName);
  const inline = parseInlineQA(paragraphs, categories, fileName);
  const separateQA = parseSeparateQA(paragraphs, categories, fileName);
  const intentReply = parseIntentReply(paragraphs, categories, fileName);

  return dedupe([...numbered, ...inline, ...separateQA, ...intentReply]);
}

export async function buildFaqs() {
  const entries = await readdir(ASSETS_DIR);
  const docFiles = entries.filter(
    (name) =>
      !SKIP_FILES.has(name) &&
      [".docx", ".pdf"].includes(path.extname(name).toLowerCase()),
  );

  let allFaqs = [];
  for (const fileName of docFiles) {
    const faqs = await buildFaqsForFile(fileName);
    console.log(`${fileName}: extracted ${faqs.length} Q&A`);
    allFaqs = allFaqs.concat(faqs);
  }

  const merged = mergeAcrossFiles(allFaqs);

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(merged, null, 2), "utf-8");
  console.log(`\nWrote ${merged.length} FAQs (from ${allFaqs.length} raw matches) to ${path.relative(process.cwd(), OUT_FILE)}`);

  try {
    await syncToSupabase(merged);
    console.log("Synced new questions to Supabase.");
  } catch (err) {
    console.warn("Could not sync to Supabase (site will show whatever is already there):", err.message ?? err);
  }
}

const isMain = path.resolve(process.argv[1] ?? "") === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  buildFaqs().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
