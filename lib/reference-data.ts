// Static reference data shared by the seed script and the UI (level
// ordering, location metadata, fixed FX rates). Not stored in a table for
// FX/levels because they're demo-fixed constants; Locations/JobProfiles/
// CompBands themselves ARE rows in the DB (see prisma/schema.prisma) —
// this file is what seed.ts uses to populate those rows consistently.

export const LEVEL_ORDER = [
  "IC1", "IC2", "IC3", "IC4", "IC5", "IC6", "IC7",
  "M3", "M4", "M5", "M6",
] as const;

export type LevelCode = (typeof LEVEL_ORDER)[number];

export const LEVEL_INFO: Record<LevelCode, { title: string; track: "IC" | "M"; bandUsd: [number, number, number] }> = {
  IC1: { title: "Individual Contributor I", track: "IC", bandUsd: [90000, 105000, 125000] },
  IC2: { title: "Individual Contributor II", track: "IC", bandUsd: [110000, 128000, 150000] },
  IC3: { title: "Individual Contributor III", track: "IC", bandUsd: [140000, 162000, 190000] },
  IC4: { title: "Senior Individual Contributor", track: "IC", bandUsd: [175000, 198000, 225000] },
  IC5: { title: "Staff Individual Contributor", track: "IC", bandUsd: [215000, 248000, 285000] },
  IC6: { title: "Senior Staff Individual Contributor", track: "IC", bandUsd: [280000, 325000, 375000] },
  IC7: { title: "Principal Individual Contributor", track: "IC", bandUsd: [370000, 425000, 485000] },
  M3: { title: "Manager", track: "M", bandUsd: [165000, 185000, 205000] },
  M4: { title: "Director", track: "M", bandUsd: [205000, 235000, 265000] },
  M5: { title: "Senior Director", track: "M", bandUsd: [260000, 292000, 325000] },
  M6: { title: "Vice President", track: "M", bandUsd: [325000, 365000, 410000] },
};

export const LOCATIONS = [
  { id: "SF", name: "San Francisco", countryCode: "US", weight: 0.33 },
  { id: "SJ", name: "San Jose", countryCode: "US", weight: 0.21 },
  { id: "REMOTE_US", name: "Remote (US)", countryCode: "US", weight: 0.21 },
  { id: "TORONTO", name: "Toronto", countryCode: "CA", weight: 0.08 },
  { id: "LONDON", name: "London", countryCode: "GB", weight: 0.08 },
  { id: "BANGALORE", name: "Bangalore", countryCode: "IN", weight: 0.09 },
] as const;

export const DEPARTMENTS = [
  { id: "GPU_CLOUD", name: "GPU Cloud", weight: 0.3 },
  { id: "ON_PREM", name: "On-Prem", weight: 0.15 },
  { id: "ENGINEERING", name: "Engineering", weight: 0.4 },
  { id: "GA", name: "G&A", weight: 0.15 },
] as const;

// Demo-fixed FX rates: 1 unit of local currency = `toUsd` USD.
export const FX_RATES: Record<string, number> = {
  USD: 1,
  GBP: 1.27,
  CAD: 0.73,
  INR: 0.012,
};

export const CURRENCY_BY_COUNTRY: Record<string, string> = {
  US: "USD",
  CA: "CAD",
  GB: "GBP",
  IN: "INR",
};

export function usdToLocal(usd: number, currency: string): number {
  const rate = FX_RATES[currency] ?? 1;
  return usd / rate;
}

export function toUsd(amount: number, currency: string): number {
  const rate = FX_RATES[currency] ?? 1;
  return amount * rate;
}
