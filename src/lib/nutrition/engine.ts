// Nutrition for a recipe: match each ingredient to a food, estimate grams, add it up.

import type { Recipe, RecipeIngredient } from "@/lib/types";
import { scaleIngredient, tbspOf } from "@/lib/recipes/quantity";
import { addNutrients, scaleNutrients, type Nutrients } from "./nutrients";
import afcd from "./data/afcd.json";

/** One food from the Australian Food Composition Database, nutrients per 100 g. */
export interface FoodComposition {
  key: string;
  name: string;
  n: Nutrients;
}

const FOODS = afcd as FoodComposition[];

/** Whether the food database is bundled in this build. */
export const hasFoodData = () => FOODS.length > 0;

/* ---------- grams ---------- */

/** Grams per ml for things often measured in cups or spoons. Approximate, from common kitchen conversions. */
const DENSITY: [RegExp, number][] = [
  [/\bflour\b/, 0.53],
  [/\bicing sugar\b/, 0.5],
  [/\bbrown sugar\b/, 0.9],
  [/\bsugar\b/, 0.85],
  [/\b(rolled )?oats\b/, 0.4],
  [/\brice\b/, 0.8],
  [/\b(grated|shredded) .*cheese|\bparmesan\b/, 0.4],
  [/\bbutter\b/, 0.96],
  [/\boil\b/, 0.92],
  [/\bhoney\b|\bmaple syrup\b|\bgolden syrup\b/, 1.4],
  [/\bcocoa\b/, 0.45],
  [/\bbreadcrumbs?\b/, 0.45],
  [/\b(nuts|almonds|walnuts|cashews|peanuts)\b/, 0.6],
  [/\b(spinach|rocket|lettuce|kale|herbs|parsley|coriander|basil)\b/, 0.15],
  [/\bpeas\b|\bcorn\b/, 0.65],
];

/** Typical weight of one whole item, in grams. Approximate edible weights. */
const EACH: [RegExp, number][] = [
  [/\beggplant/, 400],
  [/\beggs?\b/, 50],
  [/\bgarlic (bulb|head)|\bbulbs? of garlic|\bheads? of garlic/, 45],
  [/\bgarlic\b|^clove$/, 5],
  [/\bspring onion|\bshallot/, 15],
  [/\bonion/, 150],
  [/\bcarrot/, 120],
  [/\bsweet potato/, 300],
  [/\bpotato/, 170],
  [/\btomato/, 120],
  [/\bbanana/, 120],
  [/\bapple|\bpear/, 150],
  [/\blemon|\blime/, 100],
  [/\bcapsicum/, 160],
  [/\bzucchini/, 200],
  [/\bcucumber/, 300],
  [/\bavocado/, 150],
  [/\bbroccoli/, 350],
  [/\bcauliflower/, 800],
  [/\bchicken breast/, 220],
  [/\bchicken thigh/, 120],
  [/\bsausage/, 70],
  [/\btortilla|\bwrap/, 60],
  [/\bslice|\bbread/, 35],
  [/\bchilli/, 10],
  [/\bcelery/, 40],
  [/\bmushroom/, 20],
  [/\b(iceberg|cos)? ?lettuce/, 500],
  [/\bleek/, 250],
  [/\btaco shell/, 13],
  [/\bsourdough/, 50],
  [/\bloaf/, 700],
  [/\bfish fillet|\bsalmon fillet/, 150],
];

const UNIT_ML: Record<string, number> = { ml: 1, L: 1000, l: 1000, tsp: 5, cup: 250 };
const UNIT_G: Record<string, number> = { g: 1, kg: 1000 };
const PACK_G: Record<string, number> = { tin: 400, jar: 300, pack: 250, bunch: 150, pinch: 0.5, sprig: 1, handful: 30, stick: 115 };

const find = (table: [RegExp, number][], name: string) => table.find(([re]) => re.test(name))?.[1];

/**
 * Best estimate of an ingredient's weight in grams, or null when we can't tell ("salt, to taste").
 * `basis` says how it was worked out, for the "how we worked this out" list.
 */
export function ingredientGrams(ing: RecipeIngredient, tbspMl: 15 | 20 = 20): { grams: number; basis: string } | null {
  const q = ing.quantityMax !== undefined && ing.quantity !== undefined ? (ing.quantity + ing.quantityMax) / 2 : ing.quantity;
  if (q === undefined || q <= 0) return null;
  const name = ing.name.toLowerCase();
  const unit = ing.unit ?? "item";
  if (UNIT_G[unit]) return { grams: q * UNIT_G[unit], basis: "as written" };
  const ml = unit === "tbsp" ? tbspMl : UNIT_ML[unit];
  if (ml) {
    const d = find(DENSITY, name) ?? 1;
    return { grams: q * ml * d, basis: d === 1 ? "1 ml ≈ 1 g" : `about ${Math.round(ml * d)} g per ${unit}` };
  }
  // "1 (400g) tin": use the size in the note when there is one.
  const size = ing.note?.match(/(\d+(?:\.\d+)?)\s*(g|kg|ml|l)\b/i);
  if (size && (unit === "tin" || unit === "jar" || unit === "pack" || unit === "item")) {
    const amount = Number(size[1]) * (/^(kg|l)$/i.test(size[2]) ? 1000 : 1);
    // "1 (400g) tin" or "200g each" is per pack; "4 chicken thighs (about 600g)" is the total.
    const perPack = unit !== "item" || /\beach\b/i.test(ing.note ?? "") || q === 1;
    return perPack ? { grams: q * amount, basis: `${size[1]}${size[2]} each` } : { grams: amount, basis: `${size[1]}${size[2]} in total` };
  }
  if (unit === "bunch" && find(DENSITY, name) === 0.15) return { grams: q * 30, basis: "about 30 g per bunch of herbs or leaves" };
  if (PACK_G[unit]) return { grams: q * PACK_G[unit], basis: `about ${PACK_G[unit]} g per ${unit}` };
  if (unit === "item" || unit === "clove" || unit === "slice") {
    const each = find(EACH, unit === "clove" ? (/garlic/.test(name) || !/\bcloves?\b/.test(name) ? "garlic" : name) : unit === "slice" ? "slice" : name);
    if (each) return { grams: q * each, basis: `about ${each} g each` };
  }
  return null;
}

/* ---------- matching ---------- */

const STOP = new Set([
  ...["fresh", "chopped", "diced", "sliced", "large", "small", "medium", "finely", "roughly", "thinly", "of", "and", "or", "the", "a", "to", "for", "whole", "lean"],
  ...["boneless", "skinless", "peeled", "minced", "crushed", "grated", "beaten", "softened", "melted", "cold", "warm", "extra", "virgin", "ripe", "clove", "tin", "can", "packet"],
]);
/** Words recipes use that the database spells differently. */
const SYNONYM: Record<string, string> = { tinned: "canned", courgette: "zucchini", courgettes: "zucchini", aubergine: "eggplant", aubergines: "eggplant", cilantro: "coriander", shrimp: "prawn", shrimps: "prawn" };
const tokens = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .map((t) => SYNONYM[t] ?? t)
    .map((t) => (t.length > 3 ? t.replace(/ies$/, "y").replace(/oes$/, "o").replace(/(?<!s)s$/, "") : t))
    .filter((t) => t.length > 1 && !STOP.has(t));

/**
 * The everyday version of common ingredients, by exact AFCD food name. Checked first, because the
 * database lists many varieties ("milk" is cow's milk, regular fat, not goat; "spaghetti" is dry
 * pasta, not tinned spaghetti in sauce). Patterns run against the cleaned-up ingredient words.
 * Where the database has no exact food (cannellini beans), the closest one stands in, and the
 * recipe page shows which food was used.
 */
const DEFAULTS: [RegExp, string][] = [
  [/^(whole |full cream |full fat |cow )?milk$/, "Milk, cow, fluid, regular fat (~3.5%)"],
  [/^(skim|skinny) milk$/, "Milk, cow, fluid, skim (~0.15% fat)"],
  [/^(light|low fat|reduced fat) milk$/, "Milk, cow, fluid, reduced fat (~1%)"],
  [/^(white |caster |granulated )?sugar$/, "Sugar, white, granulated or lump"],
  [/^icing sugar$/, "Sugar, white, icing"],
  [/^(brown |white |yellow )?onion$/, "Onion, mature, brown skinned, peeled, raw"],
  [/^red onion$/, "Onion, mature, red skinned, raw"],
  [/^(spring onion|green onion|shallot|scallion)$/, "Onion, spring, fresh, raw"],
  [/^carrot$/, "Carrot, mature, peeled, fresh, raw"],
  [/^zucchini$/, "Zucchini, green skin, fresh, unpeeled, raw"],
  [/^(red )?capsicum$/, "Capsicum, red, fresh, raw"],
  [/^(ripe )?tomato$/, "Tomato, common, raw"],
  [/^(canned|crushed|chopped|diced)( whole)? tomato$|^passata$/, "Tomato, whole, canned in tomato juice, undrained"],
  [/^tomato (paste|puree)$/, "Tomato, paste, no added salt"],
  [/^(pasta|tomato pasta|bolognese) sauce$|^marinara$/, "Sauce, pasta, tomato-based, commercial, heated"],
  [/^(dry |dried |small )?(pasta|spaghetti|penne|fettuccine|linguine|macaroni|fusilli|rigatoni|spiral|lasagne sheet|lasagna sheet|orzo|risoni)$/, "Pasta, white wheat flour, dry"],
  [/^(white |long grain |basmati |jasmine |arborio |sushi |medium grain )?rice$/, "Rice, white, uncooked"],
  [/^(cooked|leftover|steamed|boiled)( white)? rice$/, "Rice, white, boiled or rice cooker, no added salt"],
  [/^(tasty |cheddar |grated |shredded |mild |vintage )?cheese$|^cheddar$/, "Cheese, cheddar, natural, regular fat"],
  [/^(grated )?parmesan( cheese)?$/, "Cheese, parmesan, fresh, regular fat"],
  [/^(thickened |pouring |thick |single |double |heavy |whipping )?cream$/, "Cream, thickened, regular fat (~35%)"],
  [/^(greek |natural |plain |greek style )?(yoghurt|yogurt)$/, "Yoghurt, natural, regular fat (~3%)"],
  [/^(chicken |beef |vegetable |veggie |salt reduced |low salt )*(stock|broth)$/, "Stock, liquid, all flavours (except fish), prepared from commercial powder or cube"],
  [/^stock (cube|powder)$/, "Stock, dry powder or cube"],
  [/^(smoked |sweet )?paprika$/, "Paprika, dry powder"],
  [/^(canned )?(cannellini|white|borlotti|black|butter|four|three|mixed|kidney|red kidney) bean$/, "Bean, red kidney, canned, drained"],
  [/^(canned )?chickpea$/, "Chickpea, canned, drained"],
  [/^(salad|mixed|mesclun|green) (leaf|leave|lettuce)$|^(cos )?lettuce$/, "Lettuce, cos, raw"],
  [/^(white |green )?cabbage$/, "Cabbage, white, raw"],
  [/^(kalamata |black |green |pitted )?olive$/, "Olive, green or black, drained"],
  [/^sourdough( bread)?$/, "Bread, from white flour, sour dough, commercial"],
  [/^(white |sandwich )?bread$/, "Bread, from white flour"],
  [/^wholemeal bread$/, "Bread, from wholemeal flour"],
  [/^(white )?fish( fillet)?$|^(firm )?white fish( fillet)?$/, "Blue grenadier (hoki), fillet, raw"],
  [/^(white |washed |brushed )?potato$/, "Potato, pale skin, peeled, raw"],
  [/^(cooked|boiled|leftover) potato$/, "Potato, pale skin, peeled, boiled, drained"],
  [/^(butternut )?pumpkin$/, "Pumpkin, butternut, peeled, fresh, raw"],
  [/^(lebanese )?cucumber$/, "Cucumber, Lebanese, unpeeled, raw"],
  [/^(green )?apple$/, "Apple, red skin, unpeeled, raw"],
  [/^(plain |all purpose )?flour$/, "Flour, wheat, white, plain"],
  [/^(unsalted )?butter$/, "Butter, plain, salted"],
  [/^(sea |table |cooking |kosher )?salt$/, "Salt, table, iodised"],
  [/^(black )?pepper$/, "Pepper, black, ground"],
  [/^(vegetable|canola|neutral|cooking) oil$/, "Oil, vegetable"],
  [/^(olive )?oil$/, "Oil, olive"],
  [/^lemon juice$/, "Juice, lemon"],
  [/^(fresh )?(parsley|flat leaf parsley|continental parsley)$/, "Parsley, continental, fresh, raw"],
  [/^(fresh )?coriander$/, "Coriander, fresh, raw"],
  [/^(red )?chilli$/, "Chilli (chili), red, raw"],
  [/^(frozen )?pea$/, "Pea, green, fresh, raw"],
  [/^(corn|sweetcorn|corn kernel)$/, "Corn, kernels, canned in brine, drained"],
  [/^(canned )?tuna$/, "Tuna, canned in brine, drained"],
  [/^(raw |green )?prawn$/, "Prawn, flesh, raw (green)"],
  [/^(beef )?mince$/, "Beef, mince, regular fat, raw"],
  [/^(lean )?beef mince$/, "Beef, mince, regular fat, raw"],
  [/^(diced |stewing )?beef$/, "Beef, diced, lean, raw"],
  [/^(diced )?lamb$/, "Lamb, diced, lean, raw"],
  [/^coconut milk$/, "Coconut, milk, canned, regular fat"],
  [/^(plain |self raising |self rising )?wrap$|^tortilla$/, "Bread, wrap, white, commercial"],
];

/** Cooking words in a food's name: the plain ingredient in a recipe is the raw or as-bought form. */
const COOKED = /\b(boiled|baked|fried|cooked|grilled|roasted|bbq'd|barbecued|microwaved|steamed|poached|scrambled|toasted|prepared|stewed|casseroled|heated)\b/i;
const PRESERVED = /\b(canned|dried|powder|dry mix|frozen|purchased cooked)\b/i;

/** Find the closest database food for an ingredient name. Prefers raw, plain versions. */
export function matchFood(name: string, foods: FoodComposition[] = FOODS): FoodComposition | null {
  // "chicken thighs, skin on" → match on "chicken thighs"; what comes after the comma is prep.
  const want = tokens(name.split(/,|\(/)[0]);
  if (want.length === 0 || foods.length === 0) return null;
  const plain = want.join(" ");
  const preferred = DEFAULTS.find(([re]) => re.test(plain))?.[1];
  if (preferred) {
    const f = foods.find((x) => x.name === preferred);
    if (f) return f;
  }
  // The ingredient's main word ("beans" in "butter beans", "cheese" in "cream cheese") must be in the food's name.
  const head = want[want.length - 1];
  const wantsCooked = /\b(cooked|boiled|baked|roasted|fried|leftover|grilled)\b/.test(plain);
  const wantsPreserved = /\b(canned|dried|frozen|powder|ground)\b/.test(plain);
  let best: { f: FoodComposition; score: number } | null = null;
  for (const f of foods) {
    const comma = f.name.indexOf(",");
    const base = tokens(comma < 0 ? f.name : f.name.slice(0, comma));
    const rest = comma < 0 ? [] : tokens(f.name.slice(comma + 1));
    const have = [...base, ...rest];
    if (!have.includes(head)) continue;
    let hit = 0;
    for (const w of want) if (have.includes(w)) hit++;
    if (hit / want.length < 0.66) continue;
    // All the ingredient's words, nothing extra in the food's main name ("Spaghetti in tomato sauce"
    // isn't spaghetti), few extra qualifiers, and the raw, as-bought form score higher.
    let score = (hit / want.length) * 10;
    score -= base.filter((t) => !want.includes(t)).length * 1.5;
    score -= rest.filter((t) => !want.includes(t)).length * 0.25;
    if (base.every((t) => want.includes(t))) score += 2;
    if (COOKED.test(f.name)) score += wantsCooked ? 1.5 : -1.5;
    if (PRESERVED.test(f.name) && !wantsPreserved) score -= 1;
    if (/\b(raw|uncooked|fresh)\b/i.test(f.name) && !wantsCooked) score += 0.5;
    if (/\b(battered|crumbed|takeaway|fast food|canned in syrup)\b/i.test(f.name)) score -= 1;
    if (!best || score > best.score) best = { f, score };
  }
  return best && best.score >= 5 ? best.f : null;
}

/* ---------- recipes ---------- */

export interface IngredientNutrition {
  ingredient: RecipeIngredient;
  food: FoodComposition | null;
  grams: number | null;
  basis?: string;
  nutrients: Nutrients;
}

export interface RecipeNutrition {
  /** Whole recipe at the chosen servings. */
  total: Nutrients;
  perServing: Nutrients;
  rows: IngredientNutrition[];
  /** Ingredients left out of the totals (no match or no amount), not counting "to taste" extras. */
  missing: IngredientNutrition[];
  /** Share of the recipe's weight we could account for (0–1). */
  coverage: number;
}

/**
 * Nutrition for `servings` servings of a recipe. Totals are scaled; perServing is per one serving.
 * `overrides` maps an ingredient name to a database food key the user picked.
 */
export function recipeNutrition(recipe: Recipe, servings = recipe.servings, foods: FoodComposition[] = FOODS, overrides: Record<string, string> = {}): RecipeNutrition {
  const factor = servings / recipe.servings;
  const tbsp = tbspOf(recipe);
  const byKey = new Map(foods.map((f) => [f.key, f]));
  let total: Nutrients = {};
  const rows: IngredientNutrition[] = [];
  let counted = 0;
  let weighed = 0;
  for (const raw of recipe.ingredients) {
    const ing = scaleIngredient(raw, factor);
    const g = ingredientGrams(ing, tbsp);
    const food = (overrides[raw.name] && byKey.get(overrides[raw.name])) || matchFood(raw.name, foods);
    const nutrients = food && g ? scaleNutrients(food.n, g.grams / 100) : {};
    if (g) weighed += g.grams;
    if (food && g) {
      counted += g.grams;
      total = addNutrients(total, nutrients);
    }
    rows.push({ ingredient: raw, food, grams: g?.grams ?? null, basis: g?.basis, nutrients });
  }
  const missing = rows.filter((r) => (!r.food || r.grams === null) && !(r.ingredient.quantity === undefined && /to taste/i.test(r.ingredient.note ?? "")));
  return {
    total,
    perServing: scaleNutrients(total, 1 / (servings > 0 ? servings : 1)),
    rows,
    missing,
    coverage: weighed > 0 ? counted / weighed : 0,
  };
}

/** Which ingredients supply the most of a nutrient, largest first. */
export function topContributors(rows: IngredientNutrition[], key: keyof Nutrients, limit = 3): { name: string; amount: number; share: number }[] {
  const sum = rows.reduce((s, r) => s + (r.nutrients[key] ?? 0), 0);
  if (sum <= 0) return [];
  return rows
    .map((r) => ({ name: r.ingredient.name, amount: r.nutrients[key] ?? 0, share: (r.nutrients[key] ?? 0) / sum }))
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}
