// app/api/pdf-to-json/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ----------------- Types ----------------- **/
type Choice = { key: string; text: string };
type Question = {
  id: string;
  index: number;
  type: "FREE_RESPONSE" | "MULTIPLE_CHOICE";
  stem: string;
  media?: { type: "image"; url: string; alt?: string } | null;
  choices: Choice[];
  answer?: string;
};

/** ----------------- Safe pdf-parse loader ----------------- **/
async function getPdfParse(): Promise<
  (buf: Buffer) => Promise<{ text: string; numpages?: number }>
> {
  try {
    const m: any = await import("pdf-parse");
    const fn = m?.default ?? m;
    if (typeof fn !== "function")
      throw new Error("pdf-parse loaded but not a function");
    return fn;
  } catch {
    const m2: any = await import("pdf-parse/lib/pdf-parse.js");
    const fn2 = m2?.default ?? m2;
    if (typeof fn2 !== "function")
      throw new Error("pdf-parse fallback load failed");
    return fn2;
  }
}

/** ----------------- Helpers ----------------- **/
function normalizeText(t: string) {
  return t
    .replace(/\r/g, "\n")
    .replace(/\u00AD/g, "") // soft hyphen
    .replace(/[ \t]+\n/g, "\n") // strip trailing spaces at EOL
    .replace(/\n{3,}/g, "\n\n") // collapse huge gaps
    .trim();
}

const HEADER_PREFIXES = [
  "FORM A",
  "CONTINUE",
  "GRID-IN QUESTIONS",
  "MULTIPLE CHOICE QUESTIONS",
  "DIRECTIONS:",
  "THIS IS THE END OF THE TEST",
  "IF TIME REMAINS",
];

function isHeaderFooter(line: string) {
  const s = line.toUpperCase();
  return HEADER_PREFIXES.some((p) => s.startsWith(p));
}

/** ----------------- Core parser ----------------- **/
/**
 * Strategy:
 * 1) Do NOT filter lines yet. Parse blocks first.
 * 2) Recognize question starts: "58.", "58)", or a line that's only the number.
 * 3) Everything until the next question number belongs to that question.
 * 4) Inside a block, detect choices (A–H) and merge wrapped lines.
 */
function parseQuestionsFromText(raw: string) {
  const text = normalizeText(raw);
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const qStartRegex = /^(\d{1,3})[.)]?\s*$/; // allow "58.", "58)", or just "58"
  const qInlineRegex = /^(\d{1,3})[.)]\s+(.+)$/; // "58. stem text..."
  const choiceRegex = /^([A-H])[).]\s*(.*)$/;

  const blocks: { idx: number; num: number; lineIndex: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    const mInline = L.match(qInlineRegex);
    if (mInline) {
      blocks.push({ idx: i, num: parseInt(mInline[1], 10), lineIndex: i });
      continue;
    }
    const mStartOnly = L.match(qStartRegex);
    if (mStartOnly) {
      blocks.push({ idx: i, num: parseInt(mStartOnly[1], 10), lineIndex: i });
    }
  }

  const debug = {
    totalLines: lines.length,
    foundBlocks: blocks.length,
    reasonsDropped: { emptyStem: 0, malformedId: 0 },
  };

  const questions: Question[] = [];

  for (let b = 0; b < blocks.length; b++) {
    const start = blocks[b].idx;
    const end = b + 1 < blocks.length ? blocks[b + 1].idx : lines.length;
    const num = blocks[b].num;

    // Gather block lines
    const chunk = lines.slice(start, end);

    // If first line is inline (e.g., "58. Stem..."), split it
    let stemStartLine = "";
    const mInline = chunk[0].match(qInlineRegex);
    if (mInline) {
      stemStartLine = mInline[2].trim();
    } else {
      // If first line is number-only, stem starts from next line
      stemStartLine = (chunk[1] ?? "").trim();
    }

    // Now iterate remaining lines and collect stem + choices
    let stemParts: string[] = [];
    const choices: Choice[] = [];
    let lastChoiceIndex = -1;

    // Seed stem with first stem line unless it's header/footer
    if (stemStartLine && !isHeaderFooter(stemStartLine)) {
      stemParts.push(stemStartLine);
    }

    // Start from the line after the first (either 0 or 1 depending)
    const startAt = mInline ? 1 : 2;
    for (let i = startAt; i < chunk.length; i++) {
      const L = chunk[i];
      if (isHeaderFooter(L)) continue; // drop headers/footers after parse

      const cm = L.match(choiceRegex);
      if (cm) {
        const key = cm[1];
        const text = cm[2].trim();
        choices.push({ key, text });
        lastChoiceIndex = choices.length - 1;
      } else if (lastChoiceIndex >= 0) {
        // continuation of previous choice
        choices[lastChoiceIndex].text = (
          choices[lastChoiceIndex].text +
          " " +
          L
        )
          .replace(/\s{2,}/g, " ")
          .trim();
      } else {
        // continuation of stem
        stemParts.push(L);
      }
    }

    const stem = stemParts
      .join(" ")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (!stem) {
      debug.reasonsDropped.emptyStem++;
      continue;
    }

    if (!num || isNaN(num)) {
      debug.reasonsDropped.malformedId++;
      continue;
    }

    const q: Question = {
      id: `Q${num}`,
      index: num,
      type: choices.length >= 2 ? "MULTIPLE_CHOICE" : "FREE_RESPONSE",
      stem,
      media: null,
      choices: choices.map((c) => ({ key: c.key.trim(), text: c.text.trim() })),
    };

    questions.push(q);
  }

  return { questions, debug };
}

/** ----------------- Dedupe & Clean ----------------- **/
function scoreQuestion(q: Question) {
  const choicesScore = (q.choices?.length ?? 0) * 100;
  const stemScore = q.stem?.length ?? 0;
  return choicesScore + stemScore;
}

function uniqueChoices(choices: Choice[]): Choice[] {
  const map = new Map<string, string>();
  for (const c of choices) {
    const key = (c.key || "").toUpperCase().trim();
    if (!key) continue;
    const text = (c.text || "").trim();
    if (!map.has(key)) map.set(key, text);
    else {
      const prev = map.get(key)!;
      map.set(key, prev.length >= text.length ? prev : text);
    }
  }
  const order = ["A", "B", "C", "D", "E", "F", "G", "H"];
  return Array.from(map.entries())
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([key, text]) => ({ key, text }));
}

function dedupeAndClean(raw: Question[]) {
  const byId = new Map<string, Question>();
  const debug = {
    rawCount: raw.length,
    kept: 0,
    droppedShortFree: 0,
    droppedNoStem: 0,
    deduped: 0,
  };

  for (const q0 of raw) {
    if (!q0?.id || q0.index == null) {
      debug.droppedNoStem++;
      continue;
    }

    const stem = (q0.stem || "").trim();
    if (!stem) {
      debug.droppedNoStem++;
      continue;
    }

    // Keep FREE_RESPONSE even if short; only normalize choices
    const cleaned: Question = {
      ...q0,
      stem,
      choices: uniqueChoices(q0.choices || []),
    };
    if (cleaned.choices.length === 0) cleaned.type = "FREE_RESPONSE";

    const exist = byId.get(cleaned.id);
    if (!exist) {
      byId.set(cleaned.id, cleaned);
      debug.kept++;
    } else {
      debug.deduped++;
      const keep =
        scoreQuestion(cleaned) >= scoreQuestion(exist) ? cleaned : exist;
      byId.set(cleaned.id, keep);
    }
  }

  const out = Array.from(byId.values()).sort((a, b) => a.index - b.index);
  return { out, debug };
}

/** ----------------- API Handler ----------------- **/
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { error: "No file uploaded under field 'file'." },
        { status: 400 }
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());

    const pdfParse = await getPdfParse();
    const data = await pdfParse(buf);

    const text = data?.text ?? "";
    if (!text.trim()) {
      return NextResponse.json(
        { error: "PDF has no text layer (likely scanned). Use OCR." },
        { status: 422 }
      );
    }

    const parsed = parseQuestionsFromText(text);
    const deduped = dedupeAndClean(parsed.questions);

    return NextResponse.json(
      {
        meta: {
          pages: data.numpages ?? null,
          debug: {
            parse: parsed.debug,
            dedupe: deduped.debug,
          },
        },
        questions: deduped.out,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("pdf-to-json route error:", err);
    return NextResponse.json(
      {
        error: err?.message ?? "Server error",
        stack:
          process.env.NODE_ENV !== "production"
            ? String(err?.stack || err)
            : undefined,
      },
      { status: 500 }
    );
  }
}
