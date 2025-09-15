import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";

import { PDFDocument } from "pdf-lib";

function parsePagesList(input: string, max: number): number[] {
  // parse "1,3-5, 7" -> [1,3,4,5,7] (1-based, clamped to [1..max])
  const out = new Set<number>();
  const s = (input || "").trim();
  if (!s) return [];
  for (const part of s.split(/[,\s]+/)) {
    if (!part) continue;
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    let a = parseInt(m[1], 10);
    let b = m[2] ? parseInt(m[2], 10) : a;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (a > b) [a, b] = [b, a];
    a = Math.max(1, Math.min(max, a));
    b = Math.max(1, Math.min(max, b));
    for (let i = a; i <= b; i++) out.add(i);
  }
  return Array.from(out).sort((x, y) => x - y);
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const action = String(form.get("action") || "inspect"); // "inspect" | "edit"
    const file = form.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    if (
      file.type !== "application/pdf" &&
      !file.name.toLowerCase().endsWith(".pdf")
    ) {
      return NextResponse.json(
        { error: "Please upload a .pdf file" },
        { status: 400 }
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const src = await PDFDocument.load(buf, { ignoreEncryption: true });
    const total = src.getPageCount();

    if (action === "inspect") {
      return NextResponse.json({ pageCount: total });
    }

    // edit mode
    const mode = String(form.get("mode") || "keep"); // "keep" | "delete"
    const pagesStr = String(form.get("pages") || "");
    const selected = parsePagesList(pagesStr, total); // 1-based

    let keep: number[];
    if (mode === "keep") {
      keep = selected.length ? selected : []; // if empty, keep none
    } else {
      // delete mode
      const del = new Set(selected);
      keep = [];
      for (let i = 1; i <= total; i++) if (!del.has(i)) keep.push(i);
    }

    if (!keep.length) {
      return NextResponse.json(
        { error: "No pages to keep after edit." },
        { status: 400 }
      );
    }

    // Build new PDF from kept pages
    const out = await PDFDocument.create();
    const zeroBased = keep.map((n) => n - 1);
    const copied = await out.copyPages(src, zeroBased);
    copied.forEach((p) => out.addPage(p));
    const bytes = await out.save();

    const base64 = Buffer.from(bytes).toString("base64");
    const suffix = mode === "keep" ? "-pages-kept" : "-pages-deleted";
    const outName =
      (file.name.replace(/\.pdf$/i, "") || "edited") + `${suffix}.pdf`;

    return NextResponse.json({
      filename: outName,
      mime: "application/pdf",
      pageCount: total,
      keptPages: keep,
      base64,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err?.message || "Edit failed" },
      { status: 500 }
    );
  }
}
