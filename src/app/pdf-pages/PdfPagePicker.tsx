"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, FileText, Download, Scissors, RefreshCw } from "lucide-react";

type InspectResp = { pageCount: number };
type EditResp = {
  filename: string;
  mime: string;
  pageCount: number;
  keptPages: number[];
  base64: string;
};

export default function PdfPagePicker() {
  const formRef = useRef<HTMLFormElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set()); // pages the user picked
  const [mode, setMode] = useState<"keep" | "delete">("keep");
  const [pagesQuery, setPagesQuery] = useState(""); // optional manual ranges
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState<string>("edited.pdf");

  const onPick = (f?: File) => {
    setStatus(null);
    setPageCount(null);
    setSelected(new Set());
    setPagesQuery("");
    setDownloadUrl(null);
    if (!f) return setFile(null);
    if (!f.name.toLowerCase().endsWith(".pdf")) {
      setStatus("Please select a .pdf file.");
      return setFile(null);
    }
    setFile(f);
  };

  const analyze = async () => {
    if (!file) return;
    setBusy(true);
    setStatus("Analyzing PDF…");
    setPageCount(null);
    setSelected(new Set());
    setDownloadUrl(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("action", "inspect");
      const res = await fetch("/api/pdf-pages", { method: "POST", body: fd });
      if (!res.ok) throw new Error("Analyze failed");
      const data = (await res.json()) as InspectResp;
      setPageCount(data.pageCount);
      setStatus(
        `Found ${data.pageCount} page${data.pageCount === 1 ? "" : "s"}.`
      );
    } catch (e) {
      setStatus(e?.message || "Analyze failed");
    } finally {
      setBusy(false);
    }
  };

  // compress a sorted list like [1,2,3,5,7,8] -> "1-3,5,7-8"
  const compressRanges = (nums: number[]) => {
    if (!nums.length) return "";
    const out: string[] = [];
    let start = nums[0],
      prev = nums[0];
    for (let i = 1; i < nums.length; i++) {
      const n = nums[i];
      if (n === prev + 1) {
        prev = n;
      } else {
        out.push(start === prev ? `${start}` : `${start}-${prev}`);
        start = prev = n;
      }
    }
    out.push(start === prev ? `${start}` : `${start}-${prev}`);
    return out.join(",");
  };

  const apply = async () => {
    if (!file) return;
    if (!pageCount) {
      setStatus("Analyze first to get page count.");
      return;
    }
    setBusy(true);
    setStatus("Editing PDF…");
    setDownloadUrl(null);
    try {
      // Prefer manual range if user typed it, else use checkbox selection
      const pages =
        pagesQuery.trim() ||
        compressRanges(Array.from(selected).sort((a, b) => a - b));

      const fd = new FormData();
      fd.append("file", file);
      fd.append("action", "edit");
      fd.append("mode", mode);
      fd.append("pages", pages);

      const res = await fetch("/api/pdf-pages", { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Edit failed");
      }
      const data = (await res.json()) as EditResp;

      // Build blob from base64
      const byteChars = atob(data.base64);
      const byteNums = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++)
        byteNums[i] = byteChars.charCodeAt(i);
      const blob = new Blob([new Uint8Array(byteNums)], { type: data.mime });
      const url = URL.createObjectURL(blob);

      setDownloadUrl(url);
      setDownloadName(data.filename);
      setStatus(`Success. Kept pages: ${data.keptPages.join(", ")}`);
    } catch (e) {
      setStatus(e?.message || "Edit failed");
    } finally {
      setBusy(false);
    }
  };

  const togglePage = (n: number, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(n);
    else next.delete(n);
    setSelected(next);
  };

  const selectAll = () => {
    if (!pageCount) return;
    setSelected(new Set(Array.from({ length: pageCount }, (_, i) => i + 1)));
  };
  const selectNone = () => setSelected(new Set());
  const invert = () => {
    if (!pageCount) return;
    const next = new Set<number>();
    for (let i = 1; i <= pageCount; i++) if (!selected.has(i)) next.add(i);
    setSelected(next);
  };

  const resetAll = () => {
    setFile(null);
    formRef.current?.reset();
    setPageCount(null);
    setSelected(new Set());
    setPagesQuery("");
    setDownloadUrl(null);
    setStatus(null);
    setMode("keep");
  };

  return (
    <div className="mx-auto max-w-2xl p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            PDF Page Picker (keep or delete)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <form
            ref={formRef}
            className="space-y-3"
            onSubmit={(e) => e.preventDefault()}
          >
            <div className="space-y-2">
              <Label htmlFor="file">Upload PDF</Label>
              <Input
                id="file"
                type="file"
                accept="application/pdf,.pdf"
                onChange={(e) =>
                  onPick(e.currentTarget.files?.[0] || undefined)
                }
              />
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                onClick={analyze}
                disabled={!file || busy}
                className="gap-2"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Scissors className="h-4 w-4" />
                )}
                Analyze Pages
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={resetAll}
                disabled={busy}
                className="gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Reset
              </Button>
            </div>
          </form>

          {pageCount !== null && (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                Found <strong>{pageCount}</strong> page
                {pageCount === 1 ? "" : "s"}.
              </div>

              <div className="flex items-center gap-2">
                <Label>Mode:</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={mode === "keep" ? "default" : "outline"}
                    onClick={() => setMode("keep")}
                    size="sm"
                  >
                    Keep selected only
                  </Button>
                  <Button
                    type="button"
                    variant={mode === "delete" ? "default" : "outline"}
                    onClick={() => setMode("delete")}
                    size="sm"
                  >
                    Delete selected
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label>
                  {mode === "keep"
                    ? "Pick the pages to KEEP"
                    : "Pick the pages to DELETE"}
                </Label>

                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={selectAll}
                    disabled={busy}
                  >
                    Select all
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={selectNone}
                    disabled={busy}
                  >
                    Select none
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={invert}
                    disabled={busy}
                  >
                    Invert
                  </Button>
                </div>

                <div className="grid grid-cols-6 sm:grid-cols-8 gap-3">
                  {Array.from({ length: pageCount }, (_, i) => i + 1).map(
                    (n) => (
                      <label
                        key={n}
                        className="flex items-center gap-2 text-sm"
                      >
                        <Checkbox
                          checked={selected.has(n)}
                          onCheckedChange={(v) => togglePage(n, Boolean(v))}
                        />
                        <span>Pg {n}</span>
                      </label>
                    )
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ranges">Or type ranges (optional)</Label>
                <Textarea
                  id="ranges"
                  placeholder="e.g., 1-3, 5, 10-12 (overrides checkboxes)"
                  rows={2}
                  value={pagesQuery}
                  onChange={(e) => setPagesQuery(e.target.value)}
                />
              </div>

              <Button
                onClick={apply}
                disabled={!file || busy}
                className="gap-2"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Apply & Download
              </Button>
            </div>
          )}

          {downloadUrl && (
            <div className="space-y-2">
              <a
                href={downloadUrl}
                download={downloadName}
                className="inline-flex items-center gap-2 text-sm underline"
              >
                <Download className="h-4 w-4" />
                Download edited PDF ({downloadName})
              </a>
            </div>
          )}

          {status && (
            <div className="rounded-md bg-muted px-3 py-2 text-sm">
              {status}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Notes: Works on normal PDFs. Encrypted/locked PDFs may fail. No
            server-side storage—files are processed in-memory and returned
            immediately.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
