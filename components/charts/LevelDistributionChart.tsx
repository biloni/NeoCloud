"use client";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer } from "recharts";

// IC levels in blue shades, management levels in green shades — matches the palette used elsewhere.
const COLOR_BY_LEVEL: Record<string, string> = {
  IC1: "#93c5fd", IC2: "#60a5fa", IC3: "#3b82f6", IC4: "#2563eb", IC5: "#1d4ed8", IC6: "#1e40af", IC7: "#172554",
  M3: "#6ee7b7", M4: "#34d399", M5: "#10b981", M6: "#059669",
};

export function LevelDistributionChart({ data }: { data: { level: string; count: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="level" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
        <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" width={32} />
        <Tooltip
          cursor={{ fill: "hsl(var(--muted))" }}
          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
        />
        <Bar dataKey="count" name="Headcount" radius={[6, 6, 0, 0]} maxBarSize={40}>
          {data.map((d, i) => (
            <Cell key={i} fill={COLOR_BY_LEVEL[d.level] ?? "#94a3b8"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
