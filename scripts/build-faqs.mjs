import { readdir, readFile, mkdir, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { supabase } from "../src/components/supabase.js";
import { extractFaqsFromParagraphs, mergeAcrossFiles } from "../src/lib/parseFaqs.js";

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
  return extractFaqsFromParagraphs(paragraphs, fallback, fileName);
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
