import type { HouseholdProfile, Recipe, RecipeIngredient } from "@/lib/types";

/**
 * Allergy, diet and dislike filtering. This is a food-safety feature, so it leans cautious:
 * ingredient names are lower-cased, punctuation is flattened, and every term is matched as a
 * whole word with plural handling ("wraps", "noodles", "breadcrumbs"). Compound words are spelled
 * out explicitly ("bread ?crumbs?") and look-alikes ("eggplant", "nutmeg", "coconut") never match
 * because we never match on word fragments.
 */

export type FilterProfile = Pick<HouseholdProfile, "diets" | "allergies" | "dislikes"> & { likes?: string[] };

/** Lower-case, flatten punctuation to single spaces. "Gluten-Free Soy Sauce" -> "gluten free soy sauce". */
export function flat(text: string): string {
  return ` ${text.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;
}

function re(fragment: string): RegExp {
  return new RegExp(`\\b(?:${fragment})\\b`);
}

/** Phrases that look like an allergen word but are not (plant milks, nut-free "butters" and so on). */
const SAFE_PHRASES: Partial<Record<AllergenKey, RegExp>> = {
  dairy: /\b(?:coconut (?:milk|cream|yog(?:h)?urt)|(?:almond|soy|soya|oat|rice|cashew|hazelnut|macadamia|pea|plant) milk|(?:peanut|almond|cashew|nut|cocoa|shea|apple) butter|butter beans?|cream of tartar|butter lettuce|dairy free \w+|lactose free \w+ (?:milk|yog(?:h)?urt)|vegan (?:cheese|butter|cream|milk)|non dairy \w+)\b/g,
  gluten: /\b(?:pasta sauces?|(?:rice|glass|cellophane|mung bean|sweet potato|konjac|shirataki) noodles?|rice (?:paper|flour|vermicelli|wraps?)|corn (?:tortillas?|wraps?|flour|taco shells?)|(?:almond|coconut|chickpea|besan|tapioca|potato|buckwheat|rice|corn|cassava|gluten free) flour|rice (?:cakes?|crackers?|cereal|crisps)|cornflour|corn starch|cornstarch)\b/g,
};

type AllergenKey = "dairy" | "egg" | "gluten" | "peanut" | "treenut" | "shellfish" | "fish" | "soy" | "sesame";

const FIXED_GF = /\b(?:gluten free|gf|wheat free)\b/;
const FIXED_DF = /\b(?:dairy free|non dairy|vegan)\b/;

/** Detect fragments, per allergen. Written against flattened text. */
const DETECT: Record<AllergenKey, RegExp> = {
  dairy: re(
    "milks?|cheeses?|cheddar|parmesan|parmigiano|pecorino|feta|mozzarella|ricotta|haloumi|halloumi|mascarpone|brie|camembert|gruyere|gouda|paneer|provolone|cottage cheese|cream cheese|creams?|sour cream|creme fraiche|yog(?:h)?urts?|custard|ghee|butter|buttermilk|whey|casein|ice creams?|kefir|condensed milk|evaporated milk|dulce de leche|milk powder|lactose",
  ),
  egg: re("eggs?|egg whites?|egg yolks?|mayonnaise|mayo|aioli|meringues?|eggnog|hollandaise|albumen"),
  gluten: re(
    "wheat|flours?|plain flour|self raising|bread|breads|bread ?crumbs?|breadcrumbs?|panko|crumbs|pasta|spaghetti|spaghettini|penne|fettuccine|fettucine|linguine|tagliatelle|pappardelle|rigatoni|fusilli|farfalle|macaroni|lasagn?es?|orzo|cannelloni|ravioli|tortellini|gnocchi|noodles?|ramen|udon|soba|couscous|bulgur|burghul|freekeh|farro|spelt|semolina|barley|rye|oats?|rolled oats|muesli|granola|wraps?|tortillas?|pitas?|pita bread|naan|roti|chapati|flatbread|focaccia|sourdough|baguette|ciabatta|croutons?|toast|buns?|bread rolls?|bagels?|crumpets?|english muffins?|pizza bases?|pizza dough|pastry|puff pastry|filo|phyllo|shortcrust|crackers?|biscuits?|pretzels?|cakes?|cookies?|schnitzels?|dumplings?|wontons?|dumpling wrappers?|spring roll wrappers?|soy sauce|tamari|hoisin|teriyaki|worcestershire|malt|malt vinegar|beer|ale|lager|stout|seitan|batter|tempura|semolina|cornflakes|weet bix|weetbix|cereal",
  ),
  peanut: re("peanuts?|peanut butter|peanut oil|satay|groundnuts?|monkey nuts?"),
  treenut: re(
    "nuts?|almonds?|cashews?|walnuts?|pecans?|pistachios?|hazelnuts?|macadamias?|brazil nuts?|pine nuts?|pinenuts?|chestnuts?|nutella|marzipan|praline|frangipane|nut butter|mixed nuts|almond meal|almond flour|amaretto|pesto",
  ),
  shellfish: re(
    "prawns?|shrimps?|crabs?|crabmeat|lobsters?|crayfish|yabbies|yabby|moreton bay bugs?|mussels?|oysters?|oyster sauce|scallops?|clams?|pipis?|vongole|squid|calamari|octopus|cuttlefish|abalone|krill|langoustines?|scampi|shellfish|crustaceans?|molluscs?|seafood mix|marinara mix|laksa paste|belacan|shrimp paste",
  ),
  fish: re(
    "fish|fish sauce|tuna|salmon|barramundi|cod|snapper|anchov(?:y|ies)|sardines?|mackerel|trout|whiting|flathead|haddock|bream|herring|kingfish|mahi mahi|swordfish|perch|pilchards?|whitebait|fillets? of fish|caesar dressing|worcestershire|seafood|surimi|fish stock|dashi|bonito",
  ),
  soy: re("soy|soya|soy sauce|soybeans?|tofu|edamame|tempeh|miso|tamari|soy milk|textured vegetable protein|tvp|shoyu|teriyaki|hoisin|natto"),
  sesame: re("sesame|sesame seeds?|sesame oil|tahini|hummus|halva|halvah|gomashio|benne"),
};

/** Words we ignore for a specific allergen when they're part of a longer, known-safe phrase. */
const NOT_NUT = /\b(?:nutmeg|coconuts?|water chestnuts?|butternut|doughnuts?|donuts?|nutritional yeast)\b/g;
const NOT_SHELLFISH = /\b(?:oyster mushrooms?|oyster blade|oyster blade steak)\b/g;
const NOT_FISH = /\b(?:fish free|goldfish|vegan fish)\b/g;

function ingredientText(ing: RecipeIngredient): string {
  return flat(ing.name);
}

/** Does this one ingredient line contain the allergen? */
export function ingredientHasAllergen(ing: RecipeIngredient, allergen: AllergenKey): boolean {
  let t = ingredientText(ing);
  if (allergen === "gluten" && FIXED_GF.test(t)) return false;
  if (allergen === "dairy" && FIXED_DF.test(t)) return false;
  if (allergen === "egg" && /\b(?:vegan|egg free)\b/.test(t)) return false;
  const safe = SAFE_PHRASES[allergen];
  if (safe) t = t.replace(safe, " ");
  if (allergen === "treenut") {
    t = t.replace(NOT_NUT, " ");
    if (/\bnut free\b/.test(t)) return false;
  }
  if (allergen === "shellfish") t = t.replace(NOT_SHELLFISH, " ");
  if (allergen === "fish") t = t.replace(NOT_FISH, " ");
  return DETECT[allergen].test(t);
}

/** Which allergen categories does the user's free-text allergy name refer to? */
function allergenKeysFor(allergy: string): AllergenKey[] {
  const a = flat(allergy);
  const keys: AllergenKey[] = [];
  if (/\b(?:dairy|milk|lactose|cow s milk|cheese)\b/.test(a)) keys.push("dairy");
  if (/\beggs?\b/.test(a)) keys.push("egg");
  if (/\b(?:gluten|wheat|coeliac|celiac|barley|rye)\b/.test(a)) keys.push("gluten");
  if (/\b(?:peanuts?|groundnuts?)\b/.test(a)) keys.push("peanut");
  if (/\b(?:tree nuts?|nuts?|almonds?|cashews?|walnuts?|pecans?|pistachios?|hazelnuts?|macadamias?)\b/.test(a)) {
    keys.push("treenut");
    // "nuts" with no further detail also means peanuts, to be safe.
    if (/^ nuts? $/.test(a)) keys.push("peanut");
  }
  if (/\b(?:shellfish|crustaceans?|prawns?|shrimps?|crabs?|lobsters?|molluscs?|oysters?|mussels?|scallops?|squid|calamari)\b/.test(a)) keys.push("shellfish");
  if (/\b(?:fish|seafood|salmon|tuna|anchov\w+)\b/.test(a) && !/\bshellfish\b/.test(a)) keys.push("fish");
  if (/\bseafood\b/.test(a) && !keys.includes("shellfish")) keys.push("shellfish");
  if (/\b(?:soy|soya|soybeans?)\b/.test(a)) keys.push("soy");
  if (/\bsesame\b/.test(a)) keys.push("sesame");
  return keys;
}

/* ---------- word matching with simple plural handling ---------- */

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "olives" -> "olive", "berries" -> "berry", "tomatoes" -> "tomato", "glass" stays. */
export function singular(word: string): string {
  const w = word.toLowerCase();
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(?:oes|ches|shes|xes|sses)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) return w.slice(0, -1);
  return w;
}

function variants(phrase: string): string[] {
  const words = flat(phrase).trim().split(" ").filter(Boolean);
  if (words.length === 0) return [];
  const last = singular(words[words.length - 1]);
  const head = words.slice(0, -1);
  const forms = new Set<string>([last, `${last}s`, `${last}es`]);
  if (last.endsWith("y")) forms.add(`${last.slice(0, -1)}ies`);
  // Words that already end in "us"/"ss" keep their literal spelling too.
  forms.add(words[words.length - 1]);
  return [...forms].map((f) => [...head, f].join(" "));
}

/** Words that turn a food into a different product: "olive oil" is not "olives". */
const DERIVED = "oil|oils|leaf|leaves|essence|extract|flavouring|flavoring";

/** Whole-word, plural-tolerant match of a user's term against some text. */
export function termInText(text: string, term: string, opts: { allowDerived?: boolean } = {}): boolean {
  const vs = variants(term);
  if (vs.length === 0) return false;
  const body = vs.map(escapeRe).join("|");
  const guard = (opts.allowDerived ? "" : `(?!\\s+(?:${DERIVED})\\b)`) + "(?!\\s+free\\b)";
  return new RegExp(`\\b(?:${body})\\b${guard}`).test(flat(text));
}

/* ---------- diets ---------- */

const MEAT = re(
  "beef|mince|chicken|pork|bacon|lamb|hams?|sausages?|salami|steaks?|turkey|prosciutto|pancetta|chorizo|veal|duck|kangaroo|brisket|ribs?|patty|patties|pepperoni|mortadella|lard|meatballs?|meat|venison|rabbit|bone broth|gelatin|gelatine|frankfurts?|hot dogs?",
);
const SEAFOOD_SET = new Set<AllergenKey>(["fish", "shellfish"]);
const HONEY = re("honey");
const ANIMAL_EXTRA = re("gelatin|gelatine|lard|tallow|worcestershire|fish sauce|anchov(?:y|ies)|oyster sauce");
const PORK = re("pork|bacon|hams?|prosciutto|pancetta|chorizo|salami|lard|pepperoni|mortadella|gammon|speck|jamon|pork belly");
const ALCOHOL = re("wine|red wine|white wine|beer|rum|vodka|whisky|whiskey|brandy|sherry|port|liqueur|gin|mirin|sake|marsala|cider|champagne|prosecco");
const CARBY_MAIN = re(
  "pasta|spaghetti|spaghettini|penne|fettuccine|fettucine|linguine|tagliatelle|pappardelle|rigatoni|fusilli|farfalle|macaroni|lasagn?es?|orzo|gnocchi|noodles?|ramen|udon|soba|rice|basmati|jasmine|arborio|risotto|bread|sourdough|baguette|ciabatta|toast|wraps?|tortillas?|pitas?|naan|roti|buns?|bagels?|pizza bases?|couscous|potato|potatoes|hot chips|fries|quinoa",
);
const NOT_CARBY = /\b(?:rice (?:vinegar|wine|paper|bran|malt|flour)|cauliflower rice|konjac|shirataki|zucchini noodles?|zoodles?|egg noodles? free|breadcrumbs?|bread crumbs?|panko|lettuce wraps?|cabbage wraps?|rice paper)\b/g;

function anySeafood(i: RecipeIngredient) {
  return [...SEAFOOD_SET].some((k) => ingredientHasAllergen(i, k));
}
function isMeat(i: RecipeIngredient) {
  const t = flat(i.name).replace(/\b(?:meat free|vegan|vegetarian|plant based|fish stock)\b/g, " ");
  return MEAT.test(t) && !/\b(?:meatless|nut meat|coconut meat)\b/.test(t);
}
function isDairy(i: RecipeIngredient) {
  return ingredientHasAllergen(i, "dairy");
}
function isEgg(i: RecipeIngredient) {
  return ingredientHasAllergen(i, "egg");
}

function isCarbyMain(i: RecipeIngredient) {
  if (i.optional) return false;
  const t = flat(i.name).replace(NOT_CARBY, " ");
  return CARBY_MAIN.test(t);
}

/* ---------- public API ---------- */

export interface AllergenHit {
  /** What the household typed, e.g. "gluten". */
  allergy: string;
  /** The ingredient (or title) that triggered it. */
  ingredient: string;
}

/** Every allergen in this recipe that the household has listed. Empty when it is safe. */
export function allergenHits(recipe: Recipe, profile: Pick<HouseholdProfile, "allergies">): AllergenHit[] {
  const hits: AllergenHit[] = [];
  for (const raw of profile.allergies) {
    const allergy = raw.trim();
    if (!allergy) continue;
    const keys = allergenKeysFor(allergy);
    let hit: AllergenHit | null = null;
    for (const ing of recipe.ingredients) {
      if (keys.some((k) => ingredientHasAllergen(ing, k)) || termInText(ing.name, allergy, { allowDerived: true })) {
        hit = { allergy, ingredient: ing.name };
        break;
      }
    }
    // The title can name an allergen the ingredient list left out ("Peanut butter cookies").
    if (!hit) {
      const asIng: RecipeIngredient = { name: recipe.title };
      if (keys.some((k) => ingredientHasAllergen(asIng, k)) || termInText(recipe.title, allergy, { allowDerived: true })) {
        hit = { allergy, ingredient: recipe.title };
      }
    }
    if (hit) hits.push(hit);
  }
  return hits;
}

/** Disliked ingredients present in the recipe (whole word, plural tolerant). */
export function dislikeHits(recipe: Recipe, profile: Pick<HouseholdProfile, "dislikes">): string[] {
  const out: string[] = [];
  for (const d of profile.dislikes) {
    const term = d.trim();
    if (!term) continue;
    const found = recipe.ingredients.some((i) => termInText(i.name, term)) || termInText(recipe.title, term);
    if (found) out.push(term.toLowerCase());
  }
  return out;
}

/** Why a recipe is excluded for this household, or null when it is fine. */
export function exclusionReason(recipe: Recipe, profile: FilterProfile): string | null {
  const allergen = allergenHits(recipe, profile)[0];
  if (allergen) return `Contains ${allergen.allergy.toLowerCase()}`;

  const dislike = dislikeHits(recipe, profile)[0];
  if (dislike) return `Has ${dislike}`;

  const all = recipe.ingredients;
  for (const diet of profile.diets) {
    switch (diet) {
      case "vegan":
        if (all.some((i) => isMeat(i) || anySeafood(i) || isDairy(i) || isEgg(i) || HONEY.test(flat(i.name)) || ANIMAL_EXTRA.test(flat(i.name)))) {
          return "Not vegan";
        }
        break;
      case "vegetarian":
        if (all.some((i) => isMeat(i) || anySeafood(i) || ANIMAL_EXTRA.test(flat(i.name)))) return "Not vegetarian";
        break;
      case "pescatarian":
        if (all.some(isMeat)) return "Contains meat";
        break;
      case "gluten-free":
        if (all.some((i) => ingredientHasAllergen(i, "gluten"))) return "Contains gluten";
        break;
      case "dairy-free":
        if (all.some(isDairy)) return "Contains dairy";
        break;
      case "halal":
        if (all.some((i) => PORK.test(flat(i.name)))) return "Contains pork";
        if (all.some((i) => ALCOHOL.test(flat(i.name)))) return "Contains alcohol";
        break;
      case "kosher":
        if (all.some((i) => PORK.test(flat(i.name)))) return "Contains pork";
        if (all.some((i) => ingredientHasAllergen(i, "shellfish"))) return "Contains shellfish";
        break;
      case "low-carb":
        if (all.some(isCarbyMain)) return "High in carbs";
        break;
      default:
        break;
    }
  }
  return null;
}

export function isRecipeAllowed(recipe: Recipe, profile: FilterProfile): boolean {
  return exclusionReason(recipe, profile) === null;
}

/** How many of the household's likes show up in this recipe (for a small ranking boost). */
export function likeCount(recipe: Recipe, likes: string[] | undefined): number {
  if (!likes?.length) return 0;
  return likes.filter((l) => l.trim() && recipe.ingredients.some((i) => termInText(i.name, l, { allowDerived: true }))).length;
}

export type { AllergenKey };
