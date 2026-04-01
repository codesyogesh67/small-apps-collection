"use client";

import * as React from "react";
import { sortPdfFilesByDate } from "@/lib/pdf/sort-pdfs";
import { mergePdfFiles } from "@/lib/pdf/merge-pdfs";

export default function MergePdfUploader() {
  const [files, setFiles] = React.useState<File[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(e.target.files ?? []);
    console.log("selectedFiles:", selectedFiles);
    setFiles(selectedFiles);
    setError(null);
  }

  async function handleMerge() {
    try {
      setLoading(true);
      setError(null);

      console.log("files before merge:", files);

      if (!files.length) {
        throw new Error("Please select at least one PDF.");
      }

      const sortedFiles = sortPdfFilesByDate(files, "asc");

      console.log(
        "sortedFiles:",
        sortedFiles.map((file) => file.name)
      );

      const mergedBytes = await mergePdfFiles(sortedFiles);

      const blob = new Blob([mergedBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = "combined.pdf";
      a.click();

      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  const previewFiles = sortPdfFilesByDate(files, "asc");

  return (
    <div className="space-y-4">
      <input
        type="file"
        accept="application/pdf"
        multiple
        onChange={handleChange}
      />

      <button
        type="button"
        onClick={handleMerge}
        disabled={loading || files.length === 0}
        className="rounded-xl bg-black px-4 py-2 text-white disabled:opacity-50"
      >
        {loading ? "Merging..." : "Merge PDFs"}
      </button>

      {previewFiles.length > 0 && (
        <div className="space-y-1 text-sm text-slate-600">
          {previewFiles.map((file, index) => (
            <div key={`${file.name}-${index}`}>
              {index + 1}. {file.name}
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
