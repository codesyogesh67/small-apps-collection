"use client";
import React, { useState } from "react";

export default function ExtractPage() {
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [json, setJson] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [returnImages, setReturnImages] = useState(false);

  const submit = async () => {
    setLoading(true);
    setJson(null);
    try {
      let res: Response;
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("returnImages", returnImages ? "true" : "false");
        res = await fetch("/api/extract", { method: "POST", body: fd });
      } else if (url) {
        res = await fetch("/api/extract", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url, returnImages }),
        });
      } else {
        alert("Provide PDF file or URL");
        setLoading(false);
        return;
      }
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setJson(data);
    } catch (e) {
      alert(e?.message ?? "Failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-semibold">PDF → JSON Question Extractor</h1>

      <div className="space-y-2">
        <label className="block text-sm font-medium">PDF URL (optional)</label>
        <input
          className="w-full border rounded p-2"
          placeholder="https://…/test.pdf"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium">Or upload PDF</label>
        <input
          type="file"
          accept="application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>

      <label className="inline-flex items-center gap-2">
        <input
          type="checkbox"
          checked={returnImages}
          onChange={(e) => setReturnImages(e.target.checked)}
        />
        <span>Attach page images as data URLs</span>
      </label>

      <button
        disabled={loading}
        onClick={submit}
        className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
      >
        {loading ? "Extracting…" : "Extract"}
      </button>

      {json && (
        <pre className="whitespace-pre-wrap text-sm border rounded p-3 overflow-auto">
          {JSON.stringify(json, null, 2)}
        </pre>
      )}
    </div>
  );
}
