"use client";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const COLORS = ["hsl(var(--accent))", "#f59e0b", "#10b981", "#ef4444"];

// `format` is a plain string (not a function) so this component's props
// stay serializable across the Server->Client boundary when used from a
// Server Component page — functions can't be passed as props there.
type ValueFormat = "number" | "currencyK";

function formatValue(v: number, format: ValueFormat): string {
  return format === "currencyK" ? `$${Math.round(v / 1000)}k` : String(v);
}

export function ComparisonChart({
  data,
  seriesKeys,
  yLabel,
  format = "number",
}: {
  data: Record<string, any>[];
  seriesKeys: string[];
  yLabel: string;
  format?: ValueFormat;
}) {
  const formatY = (v: number) => formatValue(v, format);
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
        <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" width={60} tickFormatter={formatY} />
        <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => formatY(v)} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {seriesKeys.map((key, i) => (
          <Line key={key} type="monotone" dataKey={key} name={key} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
