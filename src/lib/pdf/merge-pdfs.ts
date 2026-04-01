// src/lib/pdf/merge-pdfs.ts
import { PDFDocument } from "pdf-lib";

export async function mergePdfFiles(files: File[]): Promise<Uint8Array> {
  const safeFiles = Array.isArray(files) ? files : [];

  if (safeFiles.length === 0) {
    throw new Error("No PDF files provided.");
  }

  const mergedPdf = await PDFDocument.create();

  for (const file of safeFiles) {
    const bytes = await file.arrayBuffer();
    const pdf = await PDFDocument.load(bytes);

    const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());

    copiedPages.forEach((page) => {
      mergedPdf.addPage(page);
    });
  }

  return await mergedPdf.save();
}
