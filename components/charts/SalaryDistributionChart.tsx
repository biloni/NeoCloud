"use client";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export function SalaryDistributionChart({ data }: { data: { bucket: string; count: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="bucket" tick={{ fontSize: 10.5 }} stroke="hsl(var(--muted-foreground))" interval={0} angle={-20} textAnchor="end" height={44} />
        <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" width={32} />
        <Tooltip
          cursor={{ fill: "hsl(var(--muted))" }}
          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
          formatter={(value: number) => [`${value} workers`, "Count"]}
        />
        <Bar dataKey="count" name="Workers" fill="hsl(142 71% 40%)" radius={[6, 6, 0, 0]} maxBarSize={48} />
      </BarChart>
    </ResponsiveContainer>
  );
}
