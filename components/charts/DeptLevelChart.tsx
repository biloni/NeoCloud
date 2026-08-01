"use client";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { LEVEL_ORDER } from "@/lib/reference-data";

const COLORS = [
  "#2563eb", "#3b82f6", "#60a5fa", "#93c5fd", // IC1-4 blues
  "#7c3aed", "#a78bfa", "#c4b5fd", // IC5-7 purples
  "#059669", "#10b981", "#34d399", "#6ee7b7", // M3-6 greens
];

export function DeptLevelChart({ data }: { data: Record<string, number | string>[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="department" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
        <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" width={32} />
        <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {LEVEL_ORDER.map((lvl, i) => (
          <Bar key={lvl} dataKey={lvl} stackId="a" fill={COLORS[i]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
