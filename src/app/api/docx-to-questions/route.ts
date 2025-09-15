// app/api/docx-to-questions/route.ts
// deps: npm i mammoth cheerio
import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";

import mammoth from "mammoth";
import * as cheerio from "cheerio";

type ChoiceOut = { key: string; text: string };
type Media = { type: "image"; url: string; alt?: string };

type QuestionOut = {
  id: string;
  index: number;
  type: "MULTIPLE_CHOICE" | "FREE_RESPONSE";
  category: string; // simple default; change as you like
  stem: string; // HTML allowed (e.g., <sup>, <sub>)
  media?: Media;
  choices?: ChoiceOut[];
  answer?: string; // e.g., "B" or "12"
};

//NEW: diagnostics type + bucket

type Unparsed = { index: number; text: string; reason?: string };

type DiagnosticsPayload = {
  questions: QuestionOut[];
  unparsed?: Unparsed[];
  stats?: {
    totalBlocks?: number;
    parsed?: number;
    unparsed?: number;
    categories?: Record<string, number>;
  };
};

type Panel = "preview" | "json" | "diag";


const unparsed: Unparsed[] = [];

const Q_START = /^\s*(\d{1,3})\s*[.)]\s+/; // 1.  /  1)
const CHOICE = /^\s*([A-H])\s*[.)]\s+(.*)$/; // A. foo / B) bar
const ANSWER = /^\s*(?:Answer|Ans|Correct Answer)\s*[:\-]\s*(.+)\s*$/i;

function normalizeAnswer(raw: string): string {
  const s = raw.trim();
  const letter = s.match(/^[A-H]\b/i)?.[0]?.toUpperCase();
  return letter ?? s.replace(/\s+/g, " ");
}

function stripPrefix(html: string, prefixRegex: RegExp): string {
  // Remove leading "1. " or "A) " from an HTML paragraph (simple textual strip)
  return html.replace(prefixRegex, "");
}

// add near the other helpers (uses cheerio you already import)
function toPlainStem(html: string): string {
  const $ = cheerio.load(`<div>${html}</div>`);
  const text = $.root().text();
  // remove tabs, <br/> effects, and collapse whitespace
  return text.replace(/\t+/g, " ").replace(/\s+/g, " ").trim();
}

// NEW: sanitize choice HTML -> plain text (remove <strong>, <tr>, <br>)
function cleanChoiceHtml(html: string): string {
  const $ = cheerio.load(`<div>${html}</div>`);
  $("strong").each((_, el) =>
    $(el).replaceWith($(el).html() || $(el).text() || "")
  );
  $("tr").each((_, el) =>
    $(el).replaceWith($(el).html() || $(el).text() || "")
  );
  $("br").replaceWith(" ");
  // Collapse tabs/whitespace
  return $.root().text().replace(/\t+/g, " ").replace(/\s+/g, " ").trim();
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    if (
      file.type !==
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" &&
      !file.name.toLowerCase().endsWith(".docx")
    ) {
      return NextResponse.json(
        { error: "Please upload a .docx file" },
        { status: 400 }
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());

    // Keep inline math-ish formatting like <sup>/<sub> by converting to HTML
    const { value: html } = await mammoth.convertToHtml(
      { buffer: buf },
      {
        styleMap: [
          // optional: ensure equation/inline code-ish content stays inline
        ],
        convertImage: mammoth.images.inline(() => Promise.resolve(null)), // ignore images
      }
    );

    const $ = cheerio.load(html);
    // Treat each <p> as a line; fall back to splitting on <br> if needed.
    const lines = $("p")
      .map((_, p) => {
        const $p = $(p);
        // preserve inner HTML (keeps <sup>, <sub>, <em>, etc.)
        const innerHtml = $p.html() ?? "";
        const text = $p.text();
        return { html: innerHtml.trim(), text: text.replace(/\s+$/g, "") };
      })
      .get()
      // Drop empty lines that are truly empty
      .filter((ln) => ln.html.length || ln.text.length);

    // --- Segment into question blocks ---
    type Line = { html: string; text: string };
    type Block = { num: number | null; lines: Line[] };

    const blocks: Block[] = [];
    let cur: Block | null = null;

    const pushCur = () => {
      if (!cur) return;
      while (
        cur.lines.length &&
        cur.lines[cur.lines.length - 1].text.trim() === ""
      ) {
        cur.lines.pop();
      }
      if (cur.lines.length) blocks.push(cur);
      cur = null;
    };

    for (const ln of lines) {
      const m = ln.text.match(Q_START);
      if (m) {
        pushCur();
        cur = { num: parseInt(m[1], 10), lines: [ln] };
      } else if (cur) {
        cur.lines.push(ln);
      }
    }
    pushCur();

    if (blocks.length === 0 && lines.length) {
      blocks.push({ num: null, lines });
    }

    // ← INSERT #2 HERE (needs `const unparsed: Unparsed[] = []` declared earlier)
    const present = new Set<number>();
    const duplicates = new Set<number>();

    for (const b of blocks) {
      if (Number.isFinite(b.num as number)) {
        const n = b.num as number;
        if (present.has(n)) duplicates.add(n);
        else present.add(n);
      }
    }
    duplicates.forEach((n) =>
      unparsed.push({ index: n, reason: "duplicate-number" })
    );

    if (present.size) {
      const nums = Array.from(present).sort((a, b) => a - b);
      const min = nums[0],
        max = nums[nums.length - 1];
      for (let i = min; i <= max; i++) {
        if (!present.has(i))
          unparsed.push({ index: i, reason: "missing-number" });
      }
    }

    // If no explicit numbering found, treat entire doc as one block
    if (blocks.length === 0 && lines.length) {
      blocks.push({ num: null, lines });
    }

    // --- Convert blocks -> your JSON schema ---

    const out: QuestionOut[] = [];

    blocks.forEach((b, i) => {
      const stemParts: string[] = [];
      const choices: ChoiceOut[] = [];
      let currentChoice: ChoiceOut | null = null;
      let answer: string | undefined;

      b.lines.forEach((ln, j) => {
        const t = ln.text.trim();

        // Choice?
        const cm = t.match(CHOICE);
        if (cm) {
          const key = cm[1].toUpperCase();
          // Remove "A. " / "B) " prefix from HTML too
          const htmlNoPrefix = stripPrefix(ln.html, /^\s*[A-H]\s*[.)]\s+/);
          currentChoice = { key, text: cleanChoiceHtml(htmlNoPrefix) };
          choices.push(currentChoice);
          return;
        }

        // Answer?
        const am = t.match(ANSWER);
        if (am) {
          answer = normalizeAnswer(am[1]);
          currentChoice = null;
          return;
        }

        // If first line of the block, strip the numeric prefix from HTML for stem
        if (j === 0) {
          const htmlNoNum = stripPrefix(ln.html, /^\s*\d{1,3}\s*[.)]\s+/);
          stemParts.push(htmlNoNum);
          currentChoice = null;
          return;
        }

        // Continuation: append to current choice if we’re inside one, else to stem
        if (currentChoice) {
          currentChoice.text = (currentChoice.text + " " + ln.html).trim();
        } else {
          stemParts.push(ln.html);
        }
      });

      // Clean stem
      const stemHTML = stemParts
        .join("<br/>")
        .replace(/(?:<br\/>\s*){3,}/g, "<br/><br/>")
        .trim();

      const type =
        choices.length >= 2 ? ("MULTIPLE_CHOICE" as const) : "FREE_RESPONSE";
      const index = Number.isFinite(b.num as number)
        ? (b.num as number)
        : i + 1;

      const plainStem = toPlainStem(stemHTML); // strip all HTML/BR/tabs to plain text

      // Build media URL for 2018 Form B, e.g., /images/2018/B/q60.png
      const media: Media = {
        type: "image",
        url: `/images/2018/B/q${index}.png`,
        alt: "", // keep empty per your spec
      };

      // If the block had no explicit number in the doc
      if (!Number.isFinite(b.num as number)) {
        unparsed.push({
          index: null,
          reason: "no-number",
          sample: (b.lines[0]?.text || "").slice(0, 120),
        });
      }

      // Empty or too-short stem (likely parse failure)
      if (!plainStem || plainStem.replace(/\s+/g, "").length < 3) {
        unparsed.push({
          index,
          reason: "empty-stem",
          sample: b.lines
            .map((l) => l.text)
            .join(" ")
            .slice(0, 140),
        });
      }

      // Suspicious choice counts
      if (choices.length === 1) {
        unparsed.push({
          index,
          reason: "incomplete-choices",
          note: "found 1 choice",
          sample: choices[0].text.slice(0, 100),
        });
      }
      if (choices.length > 8) {
        unparsed.push({
          index,
          reason: "too-many-choices",
          note: String(choices.length),
        });
      }

      out.push({
        id: `Q${index}`,
        index,
        type,
        category: "Uncategorized",
        stem: plainStem,
        media,
        choices: choices.length ? choices : [], // ensure [] present if none
        answer: "", // ← always empty string per your spec
        // ...(choices.length ? { choices } : {}),
        // ...(answer ? { answer } : {}),
      });
    });

    // Non-breaking diagnostics toggle:
    // If the client includes form field withDiagnostics=1, return an object {questions, unparsed, stats}
    // Otherwise keep returning the plain array to avoid breaking your UI.
    const withDiagnostics = form.get("withDiagnostics") === "1";

    if (withDiagnostics) {
      return NextResponse.json({
        questions: out,
        unparsed,
        stats: {
          totalBlocks: blocks.length,
          parsed: out.length,
          unparsed: unparsed.length,
        },
      });
    }

    return NextResponse.json(out, {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err?.message ?? "Conversion failed" },
      { status: 500 }
    );
  }
}
