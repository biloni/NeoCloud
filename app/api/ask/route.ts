import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { TOOL_DEFINITIONS, executeTool } from "@/lib/ai-tools";
import { getAuthContext } from "@/lib/auth-context";
import { can } from "@/security/authorization";
import { Permission } from "@/security/permissions";

export const dynamic = "force-dynamic";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const MAX_TOOL_ROUNDS = 4;

const SYSTEM_PROMPT = `You are "Ask People OS", an internal assistant for NeoCloud Inc.'s People/HR team.

Guardrails (follow strictly):
- Answer ONLY using facts returned by tool calls. Never invent worker names, salaries, dates, or counts.
- If a tool returns no matches or an error, say so plainly — do not guess.
- Prefer aggregate, department-level answers over singling out individuals. If asked about one named individual with a legitimate business reason (e.g. "what is E0004's comp vs band"), you may answer directly using tool data — but never speculate about a specific individual's attrition risk, performance, or personal circumstances; that requires HR governance this tool does not provide.
- When asked to draft a document (offer letter, promotion announcement, PIP notice), call draft_document to get the facts, then write the draft in your response. ALWAYS prefix generated documents with "DRAFT — for review, not final" and never claim it has been sent anywhere.
- Be concise. Use tables (markdown) for lists of workers. Cite specific numbers from tool results.
- This tool has no write access beyond the read-only tools provided — you cannot change any HR data.`;

// Minimal in-memory rate limit (single-tenant demo; documented in README as a guardrail, not production-grade).
const rateWindow = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(key: string, max = 20, windowMs = 60_000): boolean {
  const now = Date.now();
  const entry = rateWindow.get(key);
  if (!entry || now > entry.resetAt) {
    rateWindow.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= max) return false;
  entry.count++;
  return true;
}

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (!can(ctx, Permission.VIEW_ASK_PEOPLE_OS)) {
    return NextResponse.json({ error: "You don't have access to Ask People OS." }, { status: 403 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured. Set it in .env to enable Ask People OS (see README)." },
      { status: 503 }
    );
  }

  if (!checkRateLimit("global")) {
    return NextResponse.json({ error: "Rate limit exceeded. Please wait a moment and try again." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question) return NextResponse.json({ error: "Missing `question`" }, { status: 400 });
  if (question.length > 2000) return NextResponse.json({ error: "Question too long" }, { status: 400 });

  const client = new Anthropic({ apiKey });
  const conversation: Anthropic.MessageParam[] = [{ role: "user", content: question }];
  const toolCallLog: { name: string; input: unknown }[] = [];

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        tools: TOOL_DEFINITIONS,
        messages: conversation,
      });

      const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (toolUseBlocks.length === 0) {
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n");
        return NextResponse.json({ reply: text, toolCalls: toolCallLog });
      }

      conversation.push({ role: "assistant", content: response.content });
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        let result: unknown;
        try {
          result = await executeTool(block.name, block.input);
        } catch (e) {
          result = { error: e instanceof Error ? e.message : "Tool execution failed" };
        }
        toolCallLog.push({ name: block.name, input: block.input });
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
      }
      conversation.push({ role: "user", content: toolResults });
    }

    return NextResponse.json({
      reply: "I wasn't able to finish within the tool-call budget for this request. Try a narrower question.",
      toolCalls: toolCallLog,
    });
  } catch (e) {
    console.error("Ask People OS error:", e);
    return NextResponse.json({ error: "Something went wrong calling the AI service. Please try again." }, { status: 500 });
  }
}
