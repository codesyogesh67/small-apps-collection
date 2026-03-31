import "server-only";

import * as pdfjsLib from "pdfjs-dist";
import { createCanvas } from "@napi-rs/canvas";

(pdfjsLib as any).GlobalWorkerOptions.workerSrc =
  require("pdfjs-dist/build/pdf.worker.js");

export type PageOcr = { page: number; text: string; pngDataUrl?: string };

export async function pdfArrayBufferFromUrlOrFile(
  fileOrUrl: File | string
): Promise<ArrayBuffer> {
  if (typeof fileOrUrl === "string") {
    const res = await fetch(fileOrUrl);
    if (!res.ok) throw new Error(`Failed to fetch PDF: ${res.status}`);
    return await res.arrayBuffer();
  }
  return await fileOrUrl.arrayBuffer();
}

export async function ocrPdf(
  pdfBytes: ArrayBuffer,
  opts?: { dpi?: number; returnImages?: boolean; maxPages?: number }
): Promise<PageOcr[]> {
  const dpi = opts?.dpi ?? 180; // good balance for OCR
  const returnImages = !!opts?.returnImages;
  const maxPages = opts?.maxPages ?? Infinity;

  const doc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
  const numPages = Math.min(doc.numPages, maxPages);
  const out: PageOcr[] = [];

  // Lazy import tesseract to avoid cold start overhead if you only parse text
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, { logger: () => {} });

  for (let p = 1; p <= numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: dpi / 72 }); // 72 DPI base
    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext("2d") as any;

    // Render PDF page to canvas
    await page.render({
      canvasContext: ctx,
      viewport,
    }).promise;

    const pngBuf = canvas.toBuffer("image/png");
    const { data: { text } } = await worker.recognize(pngBuf);

    out.push({
      page: p,
      text: text.replace(/\u00AD/g, ""), // remove soft hyphen artifacts
      pngDataUrl: returnImages
        ? `data:image/png;base64,${pngBuf.toString("base64")}`
        : undefined,
    });
  }

  await worker.terminate();
  return out;
}
