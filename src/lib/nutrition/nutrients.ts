// The nutrients Larder tracks, in the units the Australian Food Composition Database uses.

export type NutrientKey =
  | "energyKj"
  | "protein"
  | "fat"
  | "satFat"
  | "carbs"
  | "sugars"
  | "fibre"
  | "sodium"
  | "potassium"
  | "calcium"
  | "iron"
  | "magnesium"
  | "zinc"
  | "vitC"
  | "vitA"
  | "folate"
  | "b12"
  | "vitD"
  | "iodine";

export type Nutrients = Partial<Record<NutrientKey, number>>;

export interface NutrientInfo {
  key: NutrientKey;
  label: string;
  unit: "kJ" | "g" | "mg" | "µg";
  group: "energy" | "macro" | "micro";
  /** Header patterns that identify this nutrient's column in the AFCD spreadsheet. */
  afcd: RegExp;
}

export const NUTRIENTS: NutrientInfo[] = [
  { key: "energyKj", label: "Energy", unit: "kJ", group: "energy", afcd: /^energy,? with dietary fibre.*\(kj\)/i },
  { key: "protein", label: "Protein", unit: "g", group: "macro", afcd: /^protein \(g\)/i },
  { key: "fat", label: "Fat", unit: "g", group: "macro", afcd: /^fat,? total \(g\)/i },
  { key: "satFat", label: "Saturated fat", unit: "g", group: "macro", afcd: /^total saturated fatty acids.*\(g\)/i },
  { key: "carbs", label: "Carbs", unit: "g", group: "macro", afcd: /^available carbohydrate,? with sugar alcohols \(g\)/i },
  { key: "sugars", label: "Sugars", unit: "g", group: "macro", afcd: /^total sugars \(g\)/i },
  { key: "fibre", label: "Fibre", unit: "g", group: "macro", afcd: /^total dietary fibre \(g\)/i },
  { key: "sodium", label: "Sodium", unit: "mg", group: "micro", afcd: /^sodium \(na\) \(mg\)/i },
  { key: "potassium", label: "Potassium", unit: "mg", group: "micro", afcd: /^potassium \(k\) \(mg\)/i },
  { key: "calcium", label: "Calcium", unit: "mg", group: "micro", afcd: /^calcium \(ca\) \(mg\)/i },
  { key: "iron", label: "Iron", unit: "mg", group: "micro", afcd: /^iron \(fe\) \(mg\)/i },
  { key: "magnesium", label: "Magnesium", unit: "mg", group: "micro", afcd: /^magnesium \(mg\) \(mg\)|^magnesium \(mg\)$/i },
  { key: "zinc", label: "Zinc", unit: "mg", group: "micro", afcd: /^zinc \(zn\) \(mg\)/i },
  { key: "vitC", label: "Vitamin C", unit: "mg", group: "micro", afcd: /^vitamin c \(mg\)/i },
  { key: "vitA", label: "Vitamin A", unit: "µg", group: "micro", afcd: /^vitamin a retinol equivalents \((?:µ|μ|u|mc)g\)/i },
  { key: "folate", label: "Folate", unit: "µg", group: "micro", afcd: /^dietary folate equivalents \((?:µ|μ|u|mc)g\)/i },
  { key: "b12", label: "Vitamin B12", unit: "µg", group: "micro", afcd: /^cobalamin \(b12\) \((?:µ|μ|u|mc)g\)/i },
  { key: "vitD", label: "Vitamin D", unit: "µg", group: "micro", afcd: /^vitamin d3 equivalents \((?:µ|μ|u|mc)g\)/i },
  { key: "iodine", label: "Iodine", unit: "µg", group: "micro", afcd: /^iodine \(i\) \((?:µ|μ|u|mc)g\)/i },
];

export const NUTRIENT = Object.fromEntries(NUTRIENTS.map((n) => [n.key, n])) as Record<NutrientKey, NutrientInfo>;

/** kJ to Calories (kcal), for people who count Calories and for MacroFactor/MyFitnessPal. */
export const kcal = (kj: number | undefined) => (kj === undefined ? undefined : Math.round(kj / 4.184));

export function addNutrients(a: Nutrients, b: Nutrients, factor = 1): Nutrients {
  const out: Nutrients = { ...a };
  for (const [k, v] of Object.entries(b) as [NutrientKey, number][]) {
    if (v === undefined || !Number.isFinite(v)) continue;
    out[k] = (out[k] ?? 0) + v * factor;
  }
  return out;
}

export function scaleNutrients(n: Nutrients, factor: number): Nutrients {
  return addNutrients({}, n, factor);
}

/** Display a nutrient amount with sensible precision: "12 g", "0.4 mg", "1,240 kJ". */
export function formatNutrient(value: number | undefined, unit: string): string {
  if (value === undefined) return "–";
  const v = value >= 100 ? Math.round(value).toLocaleString("en-AU") : value >= 10 ? String(Math.round(value)) : String(Math.round(value * 10) / 10);
  return `${v} ${unit}`;
}
