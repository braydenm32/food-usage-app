import { describe, expect, it } from "vitest";
import type { Recipe } from "@/lib/types";
import { allergenHits, dislikeHits, exclusionReason, isRecipeAllowed, rankRecipes } from "./suggest";
import { BUILTIN_RECIPES } from "./builtin";

function rec(ingredients: string[], title = "Test dish", tags: string[] = []): Recipe {
  return {
    id: "t",
    title,
    source: "ai",
    servings: 2,
    ingredients: ingredients.map((name) => ({ name })),
    steps: ["Cook.", "Serve."],
    tags,
  };
}
const p = (o: Partial<{ diets: never[] | string[]; allergies: string[]; dislikes: string[]; likes: string[] }>) =>
  ({ diets: [], allergies: [], dislikes: [], ...o }) as Parameters<typeof exclusionReason>[1];

const blocked = (allergy: string, ing: string) => expect(isRecipeAllowed(rec([ing]), p({ allergies: [allergy] })), `${allergy} vs ${ing}`).toBe(false);
const allowed = (allergy: string, ing: string) => expect(isRecipeAllowed(rec([ing]), p({ allergies: [allergy] })), `${allergy} vs ${ing}`).toBe(true);

describe("gluten allergy", () => {
  it.each([
    "breadcrumbs", "Panko breadcrumbs", "bread crumbs", "wraps", "tortilla wraps", "flour tortillas", "flour tortilla", "egg noodles",
    "noodles", "ramen noodles", "soy sauce", "Kikkoman soy sauce", "plain flour", "self-raising flour", "spaghetti", "pasta", "couscous",
    "sourdough", "burger buns", "hoisin sauce", "beer", "pita bread", "naan", "puff pastry", "rolled oats", "croutons",
  ])("blocks %s", (ing) => blocked("gluten", ing));

  it.each(["rice noodles", "corn tortillas", "rice flour", "almond flour", "gluten-free soy sauce", "gluten free pasta", "rice", "potatoes", "chicken thigh", "coconut milk", "cornflour", "pasta sauce"])(
    "allows %s",
    (ing) => allowed("gluten", ing),
  );

  it("also answers to wheat and coeliac", () => {
    blocked("wheat", "wraps");
    blocked("Coeliac", "breadcrumbs");
  });

  it("does not trust a gluten-free tag over the ingredients", () => {
    expect(isRecipeAllowed(rec(["soy sauce", "rice"], "Stir fry", ["gluten-free"]), p({ allergies: ["gluten"] }))).toBe(false);
  });
});

describe("dairy allergy", () => {
  it.each(["milk", "full cream milk", "tasty cheese", "cheddar", "grated parmesan", "butter", "thickened cream", "sour cream", "yoghurt", "Greek yogurt", "ghee", "buttermilk", "ice cream", "feta", "halloumi"])(
    "blocks %s",
    (ing) => blocked("dairy", ing),
  );
  it.each(["coconut milk", "coconut cream", "almond milk", "soy milk", "oat milk", "peanut butter", "butter beans", "butternut pumpkin", "cream of tartar", "dairy free yoghurt", "olive oil", "eggs"])(
    "allows %s",
    (ing) => allowed("dairy", ing),
  );
  it("handles lactose and milk allergy names", () => {
    blocked("lactose", "cheese");
    blocked("Milk", "yoghurt");
  });
});

describe("egg allergy", () => {
  it.each(["eggs", "egg", "2 eggs", "egg yolks", "egg white", "mayonnaise", "egg noodles"])("blocks %s", (ing) => blocked("egg", ing));
  it.each(["eggplant", "eggplants", "baby eggplant", "vegan mayonnaise", "chicken"])("allows %s", (ing) => allowed("egg", ing));
  it("plural allergy name still matches", () => blocked("eggs", "egg"));
});

describe("nut allergy", () => {
  it.each(["almonds", "cashews", "walnuts", "pine nuts", "peanut butter", "peanuts", "hazelnut", "macadamia nuts", "pistachios", "mixed nuts", "nut butter", "almond meal", "pesto"])(
    "blocks %s",
    (ing) => blocked("nuts", ing),
  );
  it.each(["nutmeg", "ground nutmeg", "coconut milk", "desiccated coconut", "butternut pumpkin", "water chestnuts", "doughnut", "chicken"])(
    "allows %s",
    (ing) => allowed("nuts", ing),
  );
  it("peanut allergy blocks peanuts but not almonds", () => {
    blocked("peanut", "peanut butter");
    blocked("peanuts", "satay sauce");
    allowed("peanut", "almonds");
  });
  it("tree nut allergy blocks almonds", () => blocked("tree nuts", "almonds"));
});

describe("shellfish and fish allergies", () => {
  it.each(["prawns", "king prawns", "shrimp", "crab meat", "lobster tail", "mussels", "oyster sauce", "scallops", "squid", "calamari"])("blocks %s for shellfish", (ing) =>
    blocked("shellfish", ing),
  );
  it.each(["prawns", "shrimps", "crab"])("prawn allergy blocks %s", (ing) => blocked("prawn", ing));
  it.each(["oyster mushrooms", "salmon", "fish sauce", "chicken", "coconut"])("shellfish allergy allows %s", (ing) => allowed("shellfish", ing));
  it.each(["salmon fillets", "tuna", "anchovies", "fish sauce", "barramundi"])("fish allergy blocks %s", (ing) => blocked("fish", ing));
  it.each(["prawns", "chicken"])("fish allergy allows %s", (ing) => allowed("fish", ing));
  it("seafood allergy blocks both", () => {
    blocked("seafood", "prawns");
    blocked("seafood", "salmon");
  });
});

describe("other allergens", () => {
  it("soy and sesame", () => {
    blocked("soy", "tofu");
    blocked("soy", "soy sauce");
    blocked("sesame", "tahini");
    blocked("sesame", "sesame seeds");
  });
  it("an unknown allergy matches by whole word with plurals", () => {
    blocked("kiwi fruit", "kiwi fruits");
    blocked("mushrooms", "button mushroom");
    allowed("pea", "peanut butter");
  });
  it("catches an allergen named only in the title", () => {
    expect(isRecipeAllowed(rec(["sugar", "butter"], "Peanut cookies"), p({ allergies: ["peanut"] }))).toBe(false);
  });
  it("reports which ingredient triggered it", () => {
    const hits = allergenHits(rec(["rice", "flour tortillas"]), p({ allergies: ["gluten", "dairy"] }));
    expect(hits).toEqual([{ allergy: "gluten", ingredient: "flour tortillas" }]);
  });
});

describe("dislikes", () => {
  it("olives does not exclude olive oil", () => {
    expect(isRecipeAllowed(rec(["olive oil", "garlic"]), p({ dislikes: ["olives"] }))).toBe(true);
    expect(isRecipeAllowed(rec(["extra virgin olive oil"]), p({ dislikes: ["olive"] }))).toBe(true);
    expect(isRecipeAllowed(rec(["kalamata olives", "pasta"]), p({ dislikes: ["olives"] }))).toBe(false);
    expect(isRecipeAllowed(rec(["black olive"]), p({ dislikes: ["olives"] }))).toBe(false);
  });
  it("egg does not match eggplant", () => {
    expect(isRecipeAllowed(rec(["eggplant"]), p({ dislikes: ["egg"] }))).toBe(true);
    expect(isRecipeAllowed(rec(["eggs"]), p({ dislikes: ["egg"] }))).toBe(false);
    expect(isRecipeAllowed(rec(["eggplants"]), p({ dislikes: ["eggs"] }))).toBe(true);
  });
  it("plural and berry/tomato style stems", () => {
    expect(dislikeHits(rec(["cherry tomatoes"]), p({ dislikes: ["tomato"] }))).toEqual(["tomato"]);
    expect(dislikeHits(rec(["blueberries"]), p({ dislikes: ["blueberry"] }))).toEqual(["blueberry"]);
    expect(dislikeHits(rec(["mushrooms"]), p({ dislikes: ["Mushroom"] }))).toEqual(["mushroom"]);
  });
  it("does not match inside other words", () => {
    expect(isRecipeAllowed(rec(["nutmeg"]), p({ dislikes: ["nut"] }))).toBe(true);
    expect(isRecipeAllowed(rec(["coconut milk"]), p({ dislikes: ["nuts"] }))).toBe(true);
    expect(isRecipeAllowed(rec(["pineapple"]), p({ dislikes: ["pine"] }))).toBe(true);
    expect(isRecipeAllowed(rec(["peas"]), p({ dislikes: ["pea"] }))).toBe(false);
  });
  it("blank entries are ignored", () => {
    expect(isRecipeAllowed(rec(["peas"]), p({ dislikes: ["", "  "], allergies: [" "] }))).toBe(true);
  });
});

describe("diets", () => {
  it("vegan and vegetarian", () => {
    expect(exclusionReason(rec(["prawns", "rice"]), p({ diets: ["vegetarian"] }))).toBe("Not vegetarian");
    expect(exclusionReason(rec(["fish sauce", "tofu"]), p({ diets: ["vegetarian"] }))).toBe("Not vegetarian");
    expect(exclusionReason(rec(["chickpeas", "coconut milk", "rice"]), p({ diets: ["vegan"] }))).toBeNull();
    expect(exclusionReason(rec(["honey", "oats"]), p({ diets: ["vegan"] }))).toBe("Not vegan");
    expect(exclusionReason(rec(["eggplant", "tomatoes"]), p({ diets: ["vegan"] }))).toBeNull();
    expect(exclusionReason(rec(["minced garlic", "tofu"]), p({ diets: ["vegetarian"] }))).toBeNull();
  });
  it("gluten-free and dairy-free diets use the same detectors", () => {
    expect(exclusionReason(rec(["breadcrumbs"]), p({ diets: ["gluten-free"] }))).toBe("Contains gluten");
    expect(exclusionReason(rec(["wraps"]), p({ diets: ["gluten-free"] }))).toBe("Contains gluten");
    expect(exclusionReason(rec(["rice", "chicken"]), p({ diets: ["gluten-free"] }))).toBeNull();
    expect(exclusionReason(rec(["yoghurt"]), p({ diets: ["dairy-free"] }))).toBe("Contains dairy");
    expect(exclusionReason(rec(["coconut cream"]), p({ diets: ["dairy-free"] }))).toBeNull();
  });
  it("halal and kosher", () => {
    expect(exclusionReason(rec(["bacon"]), p({ diets: ["halal"] }))).toBe("Contains pork");
    expect(exclusionReason(rec(["red wine"]), p({ diets: ["halal"] }))).toBe("Contains alcohol");
    expect(exclusionReason(rec(["prawns"]), p({ diets: ["kosher"] }))).toBe("Contains shellfish");
  });
  it("low-carb drops pasta, rice, bread, potato and noodle dishes", () => {
    for (const ing of ["spaghetti", "basmati rice", "wholemeal bread", "potatoes", "noodles", "flour tortillas"]) {
      expect(exclusionReason(rec([ing, "chicken"]), p({ diets: ["low-carb"] })), ing).toBe("High in carbs");
    }
    expect(exclusionReason(rec(["chicken", "zucchini", "rice vinegar", "cauliflower rice"]), p({ diets: ["low-carb"] }))).toBeNull();
    expect(exclusionReason(rec(["chicken", "lettuce wraps"]), p({ diets: ["low-carb"] }))).toBeNull();
  });
});

describe("ranking", () => {
  it("likes boost a recipe but allergies still remove it", () => {
    const a = rec(["chicken", "broccoli"], "A");
    const b = { ...rec(["chicken", "mushrooms"], "B"), id: "b" };
    const ranked = rankRecipes([a, b], [], p({ likes: ["mushrooms"] }));
    expect(ranked[0].recipe.id).toBe("b");
    expect(rankRecipes([a, b], [], p({ likes: ["mushrooms"], allergies: ["mushroom"] })).map((r) => r.recipe.id)).toEqual(["t"]);
  });
});

describe("built-in recipes stay safe", () => {
  it("every gluten-free allergy result contains no gluten ingredient", () => {
    const ranked = rankRecipes(BUILTIN_RECIPES, [], p({ allergies: ["gluten"] }));
    expect(ranked.length).toBeGreaterThan(5);
    for (const r of ranked) expect(allergenHits(r.recipe, p({ allergies: ["gluten"] }))).toEqual([]);
  });
  it("dairy-free, nut-free and shellfish-free leave recipes behind", () => {
    for (const allergy of ["dairy", "nuts", "shellfish", "egg"]) {
      expect(rankRecipes(BUILTIN_RECIPES, [], p({ allergies: [allergy] })).length, allergy).toBeGreaterThan(3);
    }
  });
});
