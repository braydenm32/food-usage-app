// Recipe-side knowledge about foods: which food types can stand in for each other, which ids are
// catch-alls that group unlike foods, and how big one "item", tin or pack typically is.
// Kept here, keyed by foodTypeId, so the shelf-life data stays about shelf life.

/** Food types that are the same thing for a recipe ("milk" is happy with skim or lactose free). */
const FAMILY_LIST: Record<string, string[]> = {
  milk: ["milk-full-cream", "milk-skim", "milk-lactose-free", "milk-long-life", "milk-goat"],
  bread: ["bread-loaf", "sourdough", "gluten-free-bread", "par-baked-rolls", "bread-rolls"],
  capsicum: ["capsicum-red", "capsicum-green", "capsicum-yellow"],
  onion: ["onion-brown", "onion-white", "onion-red"],
  rice: ["rice-white", "rice-brown", "rice-specialty"],
  "cooked-rice": ["cooked-rice", "rice-microwave"],
  "hard-cheese": ["cheese-tasty", "cheese-shredded", "cheese-sliced", "cheese-swiss"],
  parmesan: ["cheese-parmesan", "parmesan-shelf-stable"],
  tomato: ["tomato", "cherry-tomato"],
  chicken: ["chicken-breast", "chicken-thigh", "frozen-chicken-raw"],
  yoghurt: ["yoghurt-natural", "greek-yoghurt", "yoghurt-protein"],
  "fish-fillet": ["white-fish", "barramundi", "salmon-fillet", "frozen-fish-fillets"],
  potato: ["potato", "baby-potato"],
  pumpkin: ["pumpkin-kent", "pumpkin-cut", "squash"],
  lettuce: ["lettuce-iceberg", "lettuce-cos", "lettuce-butter", "lettuce-baby-cos"],
  spinach: ["baby-spinach", "english-spinach"],
  garlic: ["garlic", "garlic-jar", "garlic-peeled"],
  ginger: ["ginger", "ginger-paste"],
  pasta: ["pasta-dried", "dried-pasta-gf"],
  cream: ["cream-thickened", "cream-long-life"],
  wraps: ["wraps", "naan-pita"],
  "salad-leaves": ["salad-mix", "rocket", "lettuce-baby-cos", "baby-spinach"],
  "beef-strips": ["beef-diced", "steak-rump"],
};

/** Second-best swaps: counted as "have", but tried after the real thing. */
const SUBSTITUTES: Record<string, string[]> = {
  milk: ["milk-oat", "milk-almond", "milk-soy", "milk-plant-chilled", "milk-plant-other"],
  "hard-cheese": ["cheese-mozzarella"],
};

const FAMILY_OF = new Map<string, string>();
for (const [family, ids] of Object.entries(FAMILY_LIST)) for (const id of ids) if (!FAMILY_OF.has(id)) FAMILY_OF.set(id, family);

/** The family a food type belongs to, if any. */
export function familyOf(foodTypeId: string | null | undefined): string | undefined {
  return foodTypeId ? FAMILY_OF.get(foodTypeId) : undefined;
}

/**
 * Ids that group unlike foods (cumin and cinnamon are both "spices"; chicken and vegetable
 * stock are both "stock"). Sharing one of these ids isn't enough: the names must agree too.
 */
export const CATCH_ALL_IDS = new Set([
  "spices",
  "dried-herbs",
  "asian-sauces",
  "chips",
  "syrup",
  "stock",
  "stock-cubes",
  "seasoning-mix",
  "tinned-beans",
  "tinned-fish",
  "tinned-veg",
  "tinned-fruit",
  "lentils-dried",
  "nuts",
  "seeds",
  "couscous",
  "vinegar",
  "taco-kit",
  "simmer-sauce",
  "curry-paste",
  "dried-fruit",
  "frozen-mixed-veg",
  "noodles-dried",
  "olives",
  "salad-dressing",
]);

export type MatchQuality = "exact" | "family" | "substitute";

/** How well a larder food type stands in for a recipe's food type, or null when it doesn't. */
export function foodTypeMatch(recipeId: string, itemId: string): MatchQuality | null {
  if (recipeId === itemId) return "exact";
  const family = FAMILY_OF.get(recipeId);
  if (!family) return null;
  if (FAMILY_OF.get(itemId) === family) return "family";
  if (SUBSTITUTES[family]?.includes(itemId)) return "substitute";
  return null;
}

/* ---------- sizes ---------- */

/** Typical weight of one whole item, in grams (an onion is about 150 g). */
export const ITEM_GRAMS: Record<string, number> = {
  "onion-brown": 150,
  "onion-white": 150,
  "onion-red": 150,
  carrot: 120,
  potato: 200,
  "baby-potato": 50,
  "sweet-potato": 400,
  zucchini: 200,
  "capsicum-red": 180,
  "capsicum-green": 180,
  "capsicum-yellow": 180,
  tomato: 120,
  banana: 120,
  "apple-red": 150,
  pear: 180,
  lemon: 100,
  lime: 70,
  avocado: 170,
  cucumber: 300,
  garlic: 50,
  leek: 250,
  broccoli: 350,
  cauliflower: 1000,
  cabbage: 1500,
  wombok: 1000,
  "lettuce-iceberg": 500,
  eggplant: 350,
  "pumpkin-kent": 1500,
  squash: 1000,
  mushroom: 20,
  eggs: 55,
  corn: 250,
  parsnip: 150,
  beetroot: 150,
  fennel: 300,
  chilli: 10,
  "chicken-breast": 250,
  "chicken-thigh": 120,
  sausages: 75,
  "spring-onion": 15,
  celery: 50,
  ginger: 50,
};

/**
 * What one larder unit (a tin, jar, pack, bunch, loaf or bulb) holds: grams/ml, or a count of
 * the pieces a recipe asks for (slices of bread, stalks of celery, cloves of garlic).
 */
export const UNIT_CONTENTS: Record<string, { grams?: number; count?: number }> = {
  "tinned-tomatoes": { grams: 400 },
  chickpeas: { grams: 400 },
  "tinned-beans": { grams: 400 },
  "lentils-tin": { grams: 400 },
  "coconut-milk": { grams: 400 },
  "tinned-corn": { grams: 420 },
  "tuna-tin": { grams: 185 },
  "tinned-fish": { grams: 185 },
  "pasta-sauce": { grams: 500 },
  passata: { grams: 700 },
  "tomato-paste": { grams: 140 },
  "pasta-dried": { grams: 500 },
  "dried-pasta-gf": { grams: 500 },
  "noodles-dried": { grams: 400 },
  "noodles-fresh": { grams: 450 },
  breadcrumbs: { grams: 200 },
  bacon: { grams: 250 },
  "lentils-dried": { grams: 500 },
  "frozen-peas": { grams: 1000 },
  "salad-mix": { grams: 120 },
  olives: { grams: 350 },
  mayonnaise: { grams: 440 },
  "rice-microwave": { grams: 250 },
  "bread-loaf": { count: 18, grams: 650 },
  sourdough: { count: 12, grams: 750 },
  "gluten-free-bread": { count: 14, grams: 500 },
  "bread-rolls": { count: 6 },
  wraps: { count: 8 },
  "naan-pita": { count: 4 },
  "taco-shells": { count: 12 },
  sausages: { count: 8, grams: 600 },
  celery: { count: 10, grams: 500 },
  "spring-onion": { count: 8, grams: 120 },
  garlic: { count: 10, grams: 50 },
  "garlic-jar": { count: 40, grams: 200 },
  basil: { grams: 30 },
  coriander: { grams: 30 },
  "parsley-flat": { grams: 30 },
  "english-spinach": { grams: 250 },
  kale: { grams: 250 },
  "bok-choy": { grams: 400 },
  broccolini: { grams: 175 },
  asparagus: { grams: 250 },
  beetroot: { count: 4, grams: 600 },
  eggs: { count: 12 },
};
