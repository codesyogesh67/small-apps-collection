"use client";

import { useState } from "react";

type ExtractResponse = {
  meta: { totalPages: number; page: number; bytes: number };
  questions: {
    id?: string;
    index?: number;
    stem: string;
    choices?: { key: string; text: string }[];
  }[];
};

export default function UploadForm() {
  const [file, setFile] = useState<File | null>(null);
  const [page, setPage] = useState<number>(1);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ExtractResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setLoading(true);
    setError(null);
    setData(null);

    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("page", String(page));

      const res = await fetch("/api/extract", {
        method: "POST",
        body: fd,
      });

      const json = await res.json();
      if (!res.ok) {
        setError(json?.error || "Unknown error");
      } else {
        setData(json);
      }
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <form onSubmit={onSubmit} className="space-y-3 border rounded-2xl p-4">
        <div className="flex items-center gap-3">
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm"
          />
          <input
            type="number"
            min={1}
            value={page}
            onChange={(e) => setPage(Number(e.target.value))}
            className="w-24 rounded-md border px-2 py-1 text-sm"
            placeholder="Page"
            title="1-based page index"
          />
          <button
            type="submit"
            disabled={!file || loading}
            className="rounded-xl border px-3 py-2 text-sm shadow hover:shadow-md disabled:opacity-50"
          >
            {loading ? "Extracting…" : "Extract"}
          </button>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 border border-red-200">
            {error}
          </div>
        )}
      </form>

      {data && (
        <div className="space-y-2">
          <div className="text-sm text-gray-600">
            Page {data.meta.page} of {data.meta.totalPages} • PDF size{" "}
            {data.meta.bytes.toLocaleString()} bytes
          </div>

          <ul className="space-y-4">
            {data.questions.map((q, i) => (
              <li key={q.id || i} className="rounded-2xl border p-4 shadow-sm">
                <div className="font-semibold mb-2">
                  {q.index ? `Q${q.index}` : `Question ${i + 1}`}
                </div>
                <pre className="whitespace-pre-wrap text-sm leading-relaxed">
                  {q.stem}
                </pre>
                {q.choices && q.choices.length > 0 && (
                  <div className="mt-2 grid gap-1 text-sm">
                    {q.choices.map((c) => (
                      <div key={c.key}>
                        <span className="font-medium">{c.key}.</span> {c.text}
                      </div>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>

          {data.questions.length === 0 && (
            <div className="text-sm text-gray-600">
              No questions detected on this page (tweak your parser heuristics).
            </div>
          )}
        </div>
      )}
    </div>
  );
}
