// Persisted acknowledgment of payroll anomaly flags. Anomalies themselves
// are computed fresh on every load (lib/payroll.ts detectAnomalies) — this
// table just remembers which ones a human has already reviewed, keyed by
// AnomalyFlag.key (stable per type+subject+period).
import { prisma } from "./prisma";

export async function getAcknowledgments(keys: string[]): Promise<Map<string, { acknowledgedBy: string; comment: string | null; createdAt: Date }>> {
  if (keys.length === 0) return new Map();
  const rows = await prisma.anomalyAcknowledgment.findMany({ where: { anomalyKey: { in: keys } } });
  return new Map(rows.map((r) => [r.anomalyKey, { acknowledgedBy: r.acknowledgedBy, comment: r.comment, createdAt: r.createdAt }]));
}

export async function acknowledgeAnomaly(key: string, acknowledgedBy: string, comment?: string) {
  return prisma.anomalyAcknowledgment.upsert({
    where: { anomalyKey: key },
    create: { anomalyKey: key, acknowledgedBy, comment },
    update: { acknowledgedBy, comment, createdAt: new Date() },
  });
}

export async function unacknowledgeAnomaly(key: string) {
  await prisma.anomalyAcknowledgment.deleteMany({ where: { anomalyKey: key } });
}
