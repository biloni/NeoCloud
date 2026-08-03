"use client";
import { useState } from "react";
import { Card, CardTitle, Button } from "@/components/ui";
import { ConfidenceBadge, Citations, type Citation } from "@/components/ai/ConfidenceCitations";

interface ChatEntry {
  question: string;
  reply?: string;
  error?: string;
  confidence?: "high" | "medium" | "low";
  confidenceReason?: string;
  citations?: Citation[];
  toolCalls?: { name: string; input: unknown }[];
  loading?: boolean;
}

export function AskChat({ examples, framing }: { examples: string[]; framing: string }) {
  const [history, setHistory] = useState<ChatEntry[]>([]);
  const [question, setQuestion] = useState("");

  async function ask(q: string) {
    if (!q.trim()) return;
    setQuestion("");
    setHistory((h) => [...h, { question: q, loading: true }]);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      setHistory((h) =>
        h.map((entry, i) =>
          i === h.length - 1
            ? {
                question: q,
                reply: data.reply,
                error: data.error,
                confidence: data.confidence,
                confidenceReason: data.confidenceReason,
                citations: data.citations,
                toolCalls: data.toolCalls,
              }
            : entry
        )
      );
    } catch {
      setHistory((h) => h.map((entry, i) => (i === h.length - 1 ? { question: q, error: "Network error — please try again." } : entry)));
    }
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div>
        <h1>Ask People OS</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your People AI Assistant. {framing} Every answer is grounded in live tool calls over this
          application's real data — never the model's general knowledge — and carries a confidence level plus
          the sources it used.
        </p>
      </div>

      {history.length === 0 && (
        <Card className="animate-fade-in-up">
          <CardTitle>Try asking</CardTitle>
          <div className="mt-2 flex flex-wrap gap-2">
            {examples.map((ex) => (
              <button
                key={ex}
                onClick={() => ask(ex)}
                className="rounded-full border border-border px-3 py-1.5 text-xs transition-colors hover:border-accent hover:bg-accent/5 hover:text-accent"
              >
                {ex}
              </button>
            ))}
          </div>
        </Card>
      )}

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto">
        {history.map((entry, i) => (
          <div key={i} className="flex flex-col gap-2 animate-fade-in-up">
            <div className="ml-auto max-w-2xl rounded-lg bg-accent px-3 py-2 text-sm text-accent-foreground">{entry.question}</div>
            <Card className="max-w-2xl">
              {entry.loading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="flex gap-0.5">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" />
                  </span>
                  Thinking...
                </div>
              )}
              {entry.error && <div className="text-sm text-destructive">{entry.error}</div>}
              {entry.reply && (
                <>
                  {entry.confidence && (
                    <div className="mb-2">
                      <ConfidenceBadge confidence={entry.confidence} reason={entry.confidenceReason} />
                    </div>
                  )}
                  <div className="whitespace-pre-wrap text-sm">{entry.reply}</div>
                  {entry.citations && <Citations citations={entry.citations} />}
                </>
              )}
            </Card>
          </div>
        ))}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); ask(question); }} className="flex gap-2 border-t border-border pt-4">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask about headcount, org structure, comp, attrition, or draft a document..."
          aria-label="Ask the People AI Assistant"
          className="h-10 flex-1 rounded-md border border-border bg-background px-3 text-sm transition-shadow focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <Button type="submit">Ask</Button>
      </form>
    </div>
  );
}
