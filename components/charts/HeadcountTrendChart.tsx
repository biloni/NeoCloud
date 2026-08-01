"use client";
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

export function HeadcountTrendChart({ data }: { data: { month: string; headcount: number; costUsd: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="costFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(var(--accent))" stopOpacity={0.18} />
            <stop offset="95%" stopColor="hsl(var(--accent))" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
        <YAxis yAxisId="left" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" width={36} />
        <YAxis
          yAxisId="right"
          orientation="right"
          tick={{ fontSize: 11 }}
          stroke="hsl(var(--muted-foreground))"
          width={56}
          tickFormatter={(v) => `$${Math.round(v / 1000)}k`}
        />
        <Tooltip
          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
          formatter={(value: number, name: string) => (name === "Monthly cost" ? [`$${Math.round(value).toLocaleString()}`, name] : [value, name])}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Area yAxisId="right" type="monotone" dataKey="costUsd" name="Monthly cost" stroke="none" fill="url(#costFill)" />
        <Line yAxisId="left" type="monotone" dataKey="headcount" name="Headcount" stroke="hsl(221 83% 53%)" strokeWidth={2.5} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
