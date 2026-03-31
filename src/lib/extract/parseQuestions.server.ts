import "server-only";
import type { ExamPayload, Question } from "@/types/questions";

/**
 * Heuristics:
 * - Question starts: lines like "58.", "58)" or "58 –" or "58  ".
 * - Choices: A–D or A–H, variants "A.", "A)", "(A)", "A  ".
 * - We treat any block until next question start as current question body.
 */
const Q_START = /^(?<num>\d{1,3})\s*[.)-]\s*/;
const CHOICE_LINE = /^(?:\(?([A-H])\)?[.)]|\b([A-H])\b)\s+/;

type ParseOptions = {
  questionStart?: RegExp;
  choiceLine?: RegExp;
  choicesAlphabet?: string; // "ABCD" | "ABCDEFGH"
};

export function parseQuestionsFromPages(
  pages: { page: number; text: string; pngDataUrl?: string }[],
  opts?: ParseOptions
): ExamPayload {
  const qStart = opts?.questionStart ?? Q_START;
  const choiceLine = opts?.choiceLine ?? CHOICE_LINE;
  const alpha = (opts?.choicesAlphabet ?? "ABCDEFGH").split("");

  const joined = pages
    .map((p) => p.text)
    .join("\n")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n");

  const lines = joined.split("\n");

  type Work = {
    index: number;
    stemLines: string[];
    choiceLines: string[];
  };

  const questions: Work[] = [];
  let cur: Work | null = null;

  for (let raw of lines) {
    const line = raw.trim();

    // New question?
    const mQ = line.match(qStart);
    if (mQ?.groups?.num) {
      // push previous
      if (cur) questions.push(cur);
      const idx = parseInt(mQ.groups.num, 10);
      const rest = line.replace(qStart, "").trim();
      cur = { index: idx, stemLines: rest ? [rest] : [], choiceLines: [] };
      continue;
    }

    if (!cur) continue; // ignore header text before first question

    // Choice line?
    const mC = line.match(choiceLine);
    if (mC) {
      cur.choiceLines.push(line);
    } else {
      cur.stemLines.push(line);
    }
  }
  if (cur) questions.push(cur);

  // Build JSON
  const out: Question[] = questions.map((q) => {
    const stem = tidy(
      joinWithParagraphs(q.stemLines, q.choiceLines.length > 0)
    );
    const parsedChoices = parseChoices(q.choiceLines, alpha);
    const type = parsedChoices.length > 0 ? "MULTIPLE_CHOICE" : "FREE_RESPONSE";

    return {
      id: `Q${q.index}`,
      index: q.index,
      type,
      category: null,
      stem,
      media: null, // (attach page images later if desired)
      choices: parsedChoices,
    };
  });

  return { meta: { label: "Extracted from OCR" }, questions: out };
}

function tidy(s: string) {
  return s
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function joinWithParagraphs(lines: string[], hasChoices: boolean) {
  // Keep light paragraphing; avoid swallowing math symbols
  const body = lines
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!hasChoices) return body;
  return body;
}

function parseChoices(
  lines: string[],
  alpha: string[]
): { key: string; text: string }[] {
  // Accumulate by letter key
  const buckets: Record<string, string[]> = {};
  let current: string | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    const m = line.match(/^(?:\(?([A-H])\)?[.)]|\b([A-H])\b)\s*(.*)$/);
    if (m) {
      const key = (m[1] || m[2] || "").toUpperCase();
      if (!alpha.includes(key)) continue;
      current = key;
      buckets[key] = [m[3] ?? ""];
    } else if (current) {
      buckets[current].push(line);
    }
  }

  // Flatten and keep only letters that actually appeared
  return Object.keys(buckets)
    .sort((a, b) => alpha.indexOf(a) - alpha.indexOf(b))
    .map((k) => ({ key: k, text: tidy(buckets[k].join(" ")) }))
    .filter((c) => c.text.length > 0);
}
