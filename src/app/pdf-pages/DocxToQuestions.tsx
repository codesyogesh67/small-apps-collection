"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2,
  FileText,
  FileUp,
  Download,
  Clipboard,
  RefreshCw,
  Eye,
  EyeOff,
} from "lucide-react";

type ChoiceOut = { key: string; text: string };
type Unparsed = { index: number; text: string; reason?: string };

type Panel = "preview" | "json" | "diag";
type QuestionOut = {
  id: string;
  index: number;
  type: "MULTIPLE_CHOICE" | "FREE_RESPONSE";
  category: string;
  stem: string; // HTML allowed
  choices?: ChoiceOut[];
  answer?: string;
};

type DiagnosticsPayload = {
  questions: QuestionOut[];
  unparsed?: Unparsed[];
  stats?: {
    totalBlocks?: number;
    parsed?: number;
    unparsed?: number;
    categories?: Record<string, number>;
  };
};

export default function DocxToQuestions() {
  const formRef = useRef<HTMLFormElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>("preview");
  const [diag, setDiag] = useState<DiagnosticsPayload | null>(null);

  const [jsonText, setJsonText] = useState<string>("");
  const [data, setData] = useState<QuestionOut[] | null>(null);
  const [showPreview, setShowPreview] = useState(true);

  const onPick = (f?: File) => {
    setStatus(null);
    setJsonText("");
    setData(null);
    setShowPreview(true);
    if (!f) return setFile(null);
    if (!f.name.toLowerCase().endsWith(".docx")) {
      setStatus("Please select a .docx file.");
      return setFile(null);
    }
    setFile(f);
  };

  const convert = async () => {
    if (!file) return;
    setBusy(true);
    setStatus("Converting…");
    setJsonText("");
    setData(null);
    setDiag(null);

    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("withDiagnostics", "1"); // to receive {questions, unparsed, stats}

      const res = await fetch("/api/docx-to-questions", {
        method: "POST",
        body: fd,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Convert failed");
      }
      const payload: DiagnosticsPayload | QuestionOut[] = await res.json();
      const questions = Array.isArray(payload) ? payload : payload.questions;

      if (!Array.isArray(questions)) throw new Error("Malformed response");

      setData(questions);
      setJsonText(JSON.stringify(questions, null, 2));

      if (!Array.isArray(payload)) {
        setDiag({
          questions: payload.questions,
          unparsed: Array.isArray(payload.unparsed)
            ? payload.unparsed
            : undefined,
          stats: payload.stats,
        });
      }
      const total =
        (!Array.isArray(payload)
          ? payload.stats?.totalBlocks ?? payload.questions?.length
          : undefined) ?? questions.length;
      const diff = total - questions.length;

      setStatus(
        `Done. Parsed ${questions.length} question${
          questions.length === 1 ? "" : "s"
        }.`
      );
    } catch (e) {
      setStatus(e?.message || "Convert failed");
    } finally {
      setBusy(false);
    }
  };

  const copyJSON = async () => {
    try {
      await navigator.clipboard.writeText(jsonText || "[]");
      setStatus("JSON copied ✔");
    } catch {
      setStatus("Copy failed.");
    }
  };

  const downloadJSON = () => {
    const base = file?.name.replace(/\.docx$/i, "") || "questions";
    const blob = new Blob([jsonText || "[]"], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${base}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setFile(null);
    setJsonText("");
    setData(null);
    setShowPreview(true);
    setStatus(null);
    formRef.current?.reset();
  };

  return (
    <div className="mx-auto max-w-4xl p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            DOCX → Questions JSON
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Upload + Actions */}
          <form
            ref={formRef}
            onSubmit={(e) => e.preventDefault()}
            className="space-y-3"
          >
            <div className="space-y-2">
              <Label htmlFor="file">Upload .docx</Label>
              <Input
                id="file"
                type="file"
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(e) =>
                  onPick(e.currentTarget.files?.[0] || undefined)
                }
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={convert}
                disabled={!file || busy}
                className="gap-2"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileUp className="h-4 w-4" />
                )}
                Convert
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={reset}
                disabled={busy}
                className="gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Reset
              </Button>

              <div className="ml-auto flex gap-2">
                <Button
                  type="button"
                  variant={showPreview ? "default" : "outline"}
                  onClick={() => setShowPreview(true)}
                  size="sm"
                  disabled={!data}
                  className="gap-2"
                  title="Show preview"
                >
                  <Eye className="h-4 w-4" />
                  Preview
                </Button>
                <Button
                  type="button"
                  variant={!showPreview ? "default" : "outline"}
                  onClick={() => setShowPreview(false)}
                  size="sm"
                  disabled={!Array.isArray(data)}
                  className="gap-2"
                  title="Show raw JSON"
                >
                  <EyeOff className="h-4 w-4" />
                  Raw JSON
                </Button>
                <Button
                  type="button"
                  variant={panel === "diag" ? "default" : "outline"}
                  onClick={() => setPanel("diag")}
                  size="sm"
                  disabled={!diag}
                  className="gap-2"
                  title="Show diagnostics"
                >
                  <FileText className="h-4 w-4" /> Diagnostics
                </Button>
              </div>
            </div>
          </form>

          {/* Output */}
          {Array.isArray(data) && showPreview && (
            <div className="space-y-4">
              {data.map((q) => (
                <div key={q.id} className="rounded-md border p-4">
                  <div className="mb-2 text-sm text-muted-foreground">
                    <span className="font-mono">#{q.index}</span> • {q.type} •{" "}
                    {q.category}
                    {q.answer ? (
                      <>
                        {" "}
                        • Answer:{" "}
                        <span className="font-semibold">{q.answer}</span>
                      </>
                    ) : null}
                  </div>

                  {/* stem as HTML */}
                  <div
                    className="prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: q.stem }}
                  />

                  {q.choices && q.choices.length > 0 && (
                    <ul className="mt-3 space-y-1">
                      {q.choices.map((c) => (
                        <li key={c.key} className="flex gap-2">
                          <span className="font-semibold min-w-6">
                            {c.key}.
                          </span>
                          <span dangerouslySetInnerHTML={{ __html: c.text }} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}

          {data && !showPreview && (
            <>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={copyJSON}
                  className="gap-2"
                >
                  <Clipboard className="h-4 w-4" />
                  Copy JSON
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={downloadJSON}
                  className="gap-2"
                >
                  <Download className="h-4 w-4" />
                  Download .json
                </Button>
              </div>
              <Textarea
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                rows={16}
                className="font-mono"
              />
            </>
          )}

          {panel === "json" && data && (
            <>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={copyJSON}
                  className="gap-2"
                >
                  <Clipboard className="h-4 w-4" /> Copy JSON
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={downloadJSON}
                  className="gap-2"
                >
                  <Download className="h-4 w-4" /> Download .json
                </Button>

                {/* Download the entire diagnostics blob too */}
                {diag && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const base =
                        file?.name.replace(/\.docx$/i, "") || "questions";
                      const blob = new Blob([JSON.stringify(diag, null, 2)], {
                        type: "application/json;charset=utf-8",
                      });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `${base}.full.json`;
                      document.body.appendChild(a);
                      a.click();
                      a.remove();
                      URL.revokeObjectURL(url);
                    }}
                    className="gap-2"
                  >
                    <Download className="h-4 w-4" /> Download diagnostics
                  </Button>
                )}
              </div>

              <Textarea
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                rows={16}
                className="font-mono"
              />
            </>
          )}

          {panel === "diag" && diag && (
            <div className="space-y-4">
              {/* Summary badges */}
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded bg-muted px-2 py-1">
                  Parsed: <strong>{data?.length ?? 0}</strong>
                </span>
                <span className="rounded bg-muted px-2 py-1">
                  Unparsed: <strong>{diag.unparsed?.length ?? 0}</strong>
                </span>
                {typeof diag.stats?.totalBlocks === "number" && (
                  <span className="rounded bg-muted px-2 py-1">
                    Total blocks: <strong>{diag.stats.totalBlocks}</strong>
                  </span>
                )}
              </div>

              {/* Unparsed list */}
              {diag.unparsed?.length ? (
                <div className="space-y-3">
                  {diag.unparsed.map((u) => (
                    <div key={u.index} className="rounded-md border p-3">
                      <div className="mb-1 text-xs text-muted-foreground">
                        Block #{u.index}
                        {u.reason ? ` • ${u.reason}` : ""}
                      </div>
                      <pre className="whitespace-pre-wrap text-sm">
                        {u.text}
                      </pre>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  No unparsed items reported.
                </div>
              )}
            </div>
          )}

          {status && (
            <div className="rounded-md bg-muted px-3 py-2 text-sm">
              {status}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Notes: HTML in <code>stem</code> / <code>choices[].text</code>{" "}
            preserves things like <code>&lt;sup&gt;</code> and{" "}
            <code>&lt;sub&gt;</code>. If your docx uses images for figures,
            they’re ignored in this basic flow (can be extended later).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
