"use client";
import { useState } from "react";
import { Card, CardTitle, Badge, Button } from "@/components/ui";

interface ChatEntry {
  question: string;
  reply?: string;
  error?: string;
  toolCalls?: { name: string; input: unknown }[];
  loading?: boolean;
}

const EXAMPLES = [
  "Show me everyone in Engineering hired in the last 12 months whose comp is below the band midpoint",
  "What's our headcount by department?",
  "How does comp compare to band for IC4s?",
  "What's our trailing 12-month attrition rate?",
  "Draft a promotion announcement for E0004",
];

export function AskChat() {
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
      setHistory((h) => h.map((entry, i) => (i === h.length - 1 ? { question: q, reply: data.reply, error: data.error, toolCalls: data.toolCalls } : entry)));
    } catch (e) {
      setHistory((h) => h.map((entry, i) => (i === h.length - 1 ? { question: q, error: "Network error — please try again." } : entry)));
    }
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Ask People OS</h1>
        <p className="text-sm text-muted-foreground">
          Natural-language workforce queries, grounded in tool calls over the real dataset — the model never sees or writes SQL.
        </p>
      </div>

      {history.length === 0 && (
        <Card>
          <CardTitle>Try asking</CardTitle>
          <div className="mt-2 flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button key={ex} onClick={() => ask(ex)} className="rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted">
                {ex}
              </button>
            ))}
          </div>
        </Card>
      )}

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto">
        {history.map((entry, i) => (
          <div key={i} className="flex flex-col gap-2">
            <div className="ml-auto max-w-2xl rounded-lg bg-accent px-3 py-2 text-sm text-accent-foreground">{entry.question}</div>
            <Card className="max-w-2xl">
              {entry.loading && <div className="text-sm text-muted-foreground">Thinking...</div>}
              {entry.error && <div className="text-sm text-destructive">{entry.error}</div>}
              {entry.reply && <div className="whitespace-pre-wrap text-sm">{entry.reply}</div>}
              {entry.toolCalls && entry.toolCalls.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1 border-t border-border pt-2">
                  {entry.toolCalls.map((tc, j) => (
                    <Badge key={j} variant="default">{tc.name}</Badge>
                  ))}
                </div>
              )}
            </Card>
          </div>
        ))}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); ask(question); }}
        className="flex gap-2 border-t border-border pt-4"
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask about headcount, comp, attrition, or draft a document..."
          className="h-10 flex-1 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <Button type="submit">Ask</Button>
      </form>
    </div>
  );
}
