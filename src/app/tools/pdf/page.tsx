"use client";

import { useMemo, useState } from "react";

type Choice = { key: string; text: string };
type Media = { type: "image"; url: string; alt?: string } | null;
type Question = {
  id: string;
  index: number;
  type: "MULTIPLE_CHOICE" | "FREE_RESPONSE";
  category?: string | null;
  stem: string;
  media?: Media;
  choices: Choice[];
  answer?: string;
};

const HEADER_PREFIXES = [
  "FORM ",
  "CONTINUE",
  "GRID-IN QUESTIONS",
  "MULTIPLE CHOICE QUESTIONS",
  "DIRECTIONS:",
  "THIS IS THE END OF THE TEST",
  "IF TIME REMAINS",
  "CONTINUE ON TO THE NEXT PAGE",
  "CONTINUE TO THE NEXT PAGE",
];

function normalize(text: string) {
  return text
    .replace(/\r/g, "\n")
    .replace(/\u00AD/g, "") // soft hyphen
    .replace(/[ \t]+\n/g, "\n") // trailing spaces
    .replace(/\n{3,}/g, "\n\n") // collapse big gaps
    .trim();
}

function isHeaderFooter(line: string) {
  const s = line.toUpperCase();
  return HEADER_PREFIXES.some((p) => s.startsWith(p));
}

function uniqueChoices(choices: Choice[]): Choice[] {
  const map = new Map<string, string>();
  for (const c of choices) {
    const key = (c.key || "").toUpperCase().trim();
    if (!key) continue;
    const txt = (c.text || "").trim();
    if (!map.has(key)) map.set(key, txt);
    else {
      const prev = map.get(key)!;
      map.set(key, prev.length >= txt.length ? prev : txt);
    }
  }
  const order = ["A", "B", "C", "D", "E", "F", "G", "H"];
  return Array.from(map.entries())
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([key, text]) => ({ key, text }));
}

function scoreQuestion(q: Question) {
  return (q.choices?.length ?? 0) * 100 + (q.stem?.length ?? 0);
}

/**
 * Paste-in text parser.
 * Supports:
 *  - "58." or "58)" inline stems ("58. Stem…") OR number on a line by itself
 *  - Choices A–H with wrapped lines appended to the previous choice
 *  - Gentle cleaning of headers/footers AFTER a block is found
 */
function parseQuestionsFromPastedText(raw: string) {
  const t = normalize(raw);
  const lines = t
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const qInline = /^(\d{1,3})[.)]\s+(.+)$/; // "58. Stem…"
  const qSolo = /^(\d{1,3})[.)]?\s*$/; // "58" or "58." alone
  const choice = /^([A-H])[.)]\s*(.*)$/; // "A. text" / "B) text"

  // Find block starts (question numbers)
  const blocks: { idx: number; num: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    const mInline = L.match(qInline);
    if (mInline) {
      blocks.push({ idx: i, num: parseInt(mInline[1], 10) });
      continue;
    }
    const mSolo = L.match(qSolo);
    if (mSolo) {
      blocks.push({ idx: i, num: parseInt(mSolo[1], 10) });
    }
  }

  const rawQs: Question[] = [];
  for (let b = 0; b < blocks.length; b++) {
    const start = blocks[b].idx;
    const end = b + 1 < blocks.length ? blocks[b + 1].idx : lines.length;
    const chunk = lines.slice(start, end);

    let num: number | null = null;
    let stemParts: string[] = [];
    const choices: Choice[] = [];
    let lastChoice = -1;

    // First line handling
    const first = chunk[0];
    const mInline = first.match(qInline);
    const mSolo = first.match(qSolo);

    if (mInline) {
      num = parseInt(mInline[1], 10);
      const s0 = mInline[2].trim();
      if (s0 && !isHeaderFooter(s0)) stemParts.push(s0);
    } else if (mSolo) {
      num = parseInt(mSolo[1], 10);
      const s1 = (chunk[1] ?? "").trim();
      if (s1 && !isHeaderFooter(s1)) stemParts.push(s1);
    } else {
      // Not expected, skip this block
      continue;
    }

    // Walk the rest
    const startAt = mInline ? 1 : 2;
    for (let i = startAt; i < chunk.length; i++) {
      const L = chunk[i];
      if (isHeaderFooter(L)) continue;

      const cm = L.match(choice);
      if (cm) {
        const key = cm[1];
        const txt = cm[2].trim();
        choices.push({ key, text: txt });
        lastChoice = choices.length - 1;
      } else if (lastChoice >= 0) {
        choices[lastChoice].text = (choices[lastChoice].text + " " + L)
          .replace(/\s{2,}/g, " ")
          .trim();
      } else {
        stemParts.push(L);
      }
    }

    const stem = stemParts
      .join(" ")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (!num || !stem) continue;

    rawQs.push({
      id: `Q${num}`,
      index: num,
      type: choices.length >= 2 ? "MULTIPLE_CHOICE" : "FREE_RESPONSE",
      stem,
      media: null,
      choices: uniqueChoices(choices),
    });
  }

  // Dedupe by ID: keep the one with more choices/longer stem
  const dedup = new Map<string, Question>();
  for (const q of rawQs) {
    const cur = dedup.get(q.id);
    if (!cur || scoreQuestion(q) > scoreQuestion(cur)) dedup.set(q.id, q);
  }

  const out = Array.from(dedup.values()).sort((a, b) => a.index - b.index);
  return {
    out,
    counts: {
      inputLines: lines.length,
      foundBlocks: blocks.length,
      parsed: rawQs.length,
      returned: out.length,
    },
  };
}

export default function TextToJsonPage() {
  const [input, setInput] = useState("");
  const { out: questions, counts } = useMemo(
    () => parseQuestionsFromPastedText(input),
    [input]
  );

  const jsonOutput = useMemo(
    () =>
      JSON.stringify({ meta: { total: questions.length }, questions }, null, 2),
    [questions]
  );

  async function copyJson() {
    await navigator.clipboard.writeText(jsonOutput);
    alert("JSON copied ✅");
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Paste Questions → JSON</h1>
      <p className="text-sm text-zinc-600">
        Paste the plain text of your questions here (including choices like A.,
        B., ...). The parser finds numbers like “58.” or “58)” to start blocks,
        merges wrapped choice lines, removes obvious headers/footers, and
        deduplicates IDs.
      </p>

      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={`Paste your questions here...\n\nExample:\n58. In the figure, ... What is x?\nA. 12\nB. 18\nC. 36\nD. 72\n\n59) The owner of a tree farm plants pine and oak in a ratio of 8:3...`}
        className="w-full h-64 p-3 border rounded font-mono text-sm"
      />

      <div className="flex items-center justify-between">
        <div className="text-sm text-zinc-600">
          <span className="mr-4">
            lines: <b>{counts.inputLines}</b>
          </span>
          <span className="mr-4">
            blocks: <b>{counts.foundBlocks}</b>
          </span>
          <span className="mr-4">
            parsed: <b>{counts.parsed}</b>
          </span>
          <span>
            returned: <b>{counts.returned}</b>
          </span>
        </div>
        <button
          onClick={copyJson}
          className="px-3 py-1.5 rounded bg-zinc-800 text-white text-sm hover:bg-zinc-700"
        >
          Copy JSON
        </button>
      </div>

      <pre className="bg-zinc-900 text-zinc-100 p-4 rounded text-sm overflow-auto">
        {jsonOutput}
      </pre>
    </div>
  );
}
