"use client";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Card, CardTitle, Button } from "@/components/ui";
import { ConfidenceBadge, Citations, type Citation } from "@/components/ai/ConfidenceCitations";

interface Result {
  reply?: string;
  error?: string;
  confidence?: "high" | "medium" | "low";
  confidenceReason?: string;
  citations?: Citation[];
}

// Reuses the exact /api/ask pipeline (tool-use + provide_answer structured
// citations) that powers Ask People OS — this is a pre-composed question
// against the get_scenario_projection tool, not a separate AI code path.
// Same guardrails, same confidence/citation UI, zero duplicated grounding
// logic. See lib/ai-tools.ts get_scenario_projection.
export function NarrativeGenerator({ scenarioName }: { scenarioName: string | null }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function generate() {
    if (!scenarioName) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: `Write a monthly People Ops executive summary for the CFO, grounded in the "${scenarioName}" workforce planning scenario and the current workforce state. Cover: current headcount and monthly burdened cost, how the scenario's 12-month projection changes both, and any notable risk worth flagging (e.g. attrition, comp-vs-band gaps, international mix shift). Write flowing prose suitable for a CFO update — not a bullet list of raw numbers.`,
        }),
      });
      const data = await res.json();
      setResult(data);
    } catch {
      setResult({ error: "Network error — please try again." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <div>
          <CardTitle>Executive summary</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            AI-generated, grounded in this scenario's projection and the current workforce state — not free-form commentary.
          </p>
        </div>
        <Button size="sm" onClick={generate} disabled={loading || !scenarioName} className="shrink-0 gap-1.5">
          <Sparkles size={14} /> {loading ? "Generating..." : "Generate"}
        </Button>
      </div>

      {!scenarioName && (
        <p className="mt-3 text-xs text-muted-foreground">Select a saved scenario above to generate a summary for it.</p>
      )}

      {loading && (
        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <span className="flex gap-0.5">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" />
          </span>
          Drafting...
        </div>
      )}

      {result?.error && <div className="mt-3 text-sm text-destructive">{result.error}</div>}

      {result?.reply && (
        <div className="mt-3 animate-fade-in-up">
          {result.confidence && (
            <div className="mb-2">
              <ConfidenceBadge confidence={result.confidence} reason={result.confidenceReason} />
            </div>
          )}
          <div className="whitespace-pre-wrap text-sm">{result.reply}</div>
          {result.citations && <Citations citations={result.citations} />}
        </div>
      )}
    </Card>
  );
}
