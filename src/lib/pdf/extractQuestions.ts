import "server-only";

/** Basic shape you can expand later */
export type Choice = { key: string; text: string };
export type QuestionBlock = {
  index?: number;
  id?: string;
  stem: string;
  choices?: Choice[];
};

function normalizeLines(raw: string) {
  // Trim right, normalize Windows/Mac line endings → '\n'
  return raw.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
}

/**
 * Extract question blocks from a single page of text.
 * Heuristics it supports:
 * - Questions like "58. ..." or "58) ..."
 * - Choices like "A.", "B.", "C.", "D." or "A)" "B)" on their own lines
 * - Keeps multi-line stems until next question number
 */
export function extractQuestionsFromPageText(pageText: string): QuestionBlock[] {
  const text = normalizeLines(pageText);

  // Split into candidate blocks by lines that *look* like start of a question
  // e.g., "58. ", "58) "
  const lines = text.split("\n");

  // Find indices of lines that start a question
  const starts: number[] = [];
  const qStart = /^(\d{1,3})[.)]\s+/; // 1–3 digit q-number followed by '.' or ')'

  for (let i = 0; i < lines.length; i++) {
    if (qStart.test(lines[i])) starts.push(i);
  }

  // If we didn’t detect any, treat the whole page as one block (you can adjust)
  if (starts.length === 0) {
    return [{
      stem: text,
    }];
  }

  // Build question text blocks using start indices
  const blocks: string[] = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : lines.length;
    const chunk = lines.slice(start, end).join("\n").trim();
    blocks.push(chunk);
  }

  // Parse each block into stem + choices
  const choiceLine = /^\s*([A-H])[\.\)]\s+(.*)$/; // A. or A) then text (A–H just in case)
  const result: QuestionBlock[] = [];

  for (const raw of blocks) {
    const blines = raw.split("\n");
    const first = blines[0];
    const m = qStart.exec(first);
    const index = m ? Number(m[1]) : undefined;

    // Remove the leading "58. " part from the stem line
    const firstStemLine = m ? first.slice(m[0].length) : first;

    const stemLines: string[] = [firstStemLine];
    const choices: Choice[] = [];

    for (let i = 1; i < blines.length; i++) {
      const line = blines[i];
      const cm = choiceLine.exec(line);
      if (cm) {
        choices.push({ key: cm[1], text: cm[2].trim() });
      } else {
        stemLines.push(line);
      }
    }

    const stem = stemLines.join("\n").trim();

    result.push({
      index,
      id: index ? `Q${index}` : undefined,
      stem,
      choices: choices.length ? choices : undefined,
    });
  }

  return result;
}
