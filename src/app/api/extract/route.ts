import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";

import { z } from "zod";
import {
  pdfArrayBufferFromUrlOrFile,
  ocrPdf,
} from "@/lib/extract/pdfToText.server";
import { parseQuestionsFromPages } from "@/lib/extract/parseQuestions.server";
import type { ExamPayload } from "@/types/questions";

const BodySchema = z.object({
  // When using multipart/form-data, we'll read these from formData
  url: z.string().url().optional(),
  // flags:
  returnImages: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  maxPages: z.string().regex(/^\d+$/).transform(Number).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const ct = req.headers.get("content-type") || "";
    let pdfSource: File | string | null = null;
    let returnImages = false;
    let maxPages: number | undefined;

    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      const url = form.get("url");
      const parsed = BodySchema.safeParse({
        url: typeof url === "string" ? url : undefined,
        returnImages: (form.get("returnImages") as string) ?? undefined,
        maxPages: (form.get("maxPages") as string) ?? undefined,
      });
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.flatten() },
          { status: 400 }
        );
      }
      returnImages = parsed.data.returnImages ?? false;
      maxPages = parsed.data.maxPages ?? undefined;

      if (file instanceof File) pdfSource = file;
      else if (parsed.data.url) pdfSource = parsed.data.url;
      else
        return NextResponse.json(
          { error: "Provide 'file' or 'url'" },
          { status: 400 }
        );
    } else if (ct.includes("application/json")) {
      const json = await req.json();
      const parsed = BodySchema.safeParse(json);
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.flatten() },
          { status: 400 }
        );
      }
      if (!parsed.data.url) {
        return NextResponse.json(
          { error: "When posting JSON, provide 'url'." },
          { status: 400 }
        );
      }
      pdfSource = parsed.data.url;
      returnImages = parsed.data.returnImages ?? false;
      maxPages = parsed.data.maxPages ?? undefined;
    } else {
      return NextResponse.json(
        {
          error: "Use multipart/form-data (file/url) or application/json (url)",
        },
        { status: 415 }
      );
    }

    const pdfBytes = await pdfArrayBufferFromUrlOrFile(pdfSource);
    const pages = await ocrPdf(pdfBytes, {
      dpi: 180,
      returnImages: returnImages,
      maxPages,
    });
    const payload = parseQuestionsFromPages(pages);

    // Optionally attach page image to each question (same page for now).
    // If the PDF has many questions per page, this is a coarse association.
    if (returnImages) {
      const firstPageDataUrl = pages[0]?.pngDataUrl;
      for (const q of payload.questions) {
        q.media = firstPageDataUrl
          ? { type: "image", url: firstPageDataUrl, alt: "PDF page" }
          : null;
      }
    }

    const resp: ExamPayload = {
      meta: {
        label: "OCR Extract",
        source: typeof pdfSource === "string" ? pdfSource : "upload",
      },
      questions: payload.questions,
    };

    return NextResponse.json(resp);
  } catch (e) {
    console.error("extract error:", e);
    return NextResponse.json(
      { error: e?.message ?? "Extraction failed" },
      { status: 500 }
    );
  }
}
