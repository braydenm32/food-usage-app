import { describe, expect, it } from "vitest";
import { FOOD_TYPES, matchFoodType, normalise, termKey } from "./foods";

describe("FOOD_TYPES data", () => {
  it("has unique kebab-case ids", () => {
    const ids = FOOD_TYPES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("has about 500 entries", () => {
    expect(FOOD_TYPES.length).toBeGreaterThanOrEqual(500);
  });

  it("never lets one name or alias point at two foods", () => {
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    for (const f of FOOD_TYPES) {
      for (const text of [f.name, ...f.aliases]) {
        const key = termKey(text);
        expect(key, `${f.id}: "${text}" is all noise words`).not.toBe("");
        const prev = owner.get(key);
        if (prev && prev !== f.id) clashes.push(`"${text}" (${key}): ${prev} and ${f.id}`);
        else owner.set(key, f.id);
      }
    }
    expect(clashes).toEqual([]);
  });

  it("keeps raw meat and seafood to the household fridge rules", () => {
    // Raw mince, poultry, fish, patties and seafood: 2 days (owner decision). Rabbit and schnitzel: 3.
    // Whole red meat cuts: 5, and 3 once opened.
    const twoDay = ["beef-mince", "pork-mince", "chicken-mince", "chicken-breast", "chicken-thigh", "chicken-whole", "chicken-wings", "duck", "turkey", "sausages", "burger-patties", "salmon-fillet", "barramundi", "white-fish", "tuna-steak", "fish-whole", "prawns-raw", "calamari", "seafood-marinara", "kangaroo-mince", "soup-bones"];
    const short = ["rabbit", "beef-schnitzel"];
    const cuts = ["steak-rump", "beef-diced", "lamb-chops", "kangaroo-steak", "corned-beef", "goat-meat"];
    for (const id of twoDay) {
      const f = FOOD_TYPES.find((x) => x.id === id);
      expect(f, id).toMatchObject({ dateKind: "use-by", fridgeDays: 2, pantryDays: null });
      expect(f!.openedDays, id).toBeLessThanOrEqual(2);
    }
    for (const id of short) {
      const f = FOOD_TYPES.find((x) => x.id === id);
      expect(f, id).toMatchObject({ dateKind: "use-by", fridgeDays: 3, openedDays: 2, pantryDays: null });
    }
    for (const id of cuts) {
      const f = FOOD_TYPES.find((x) => x.id === id);
      expect(f, id).toMatchObject({ dateKind: "use-by", fridgeDays: 5, openedDays: 3, pantryDays: null });
    }
  });

  it("uses lowercase aliases and sane days", () => {
    for (const f of FOOD_TYPES) {
      for (const a of f.aliases) expect(a).toBe(a.toLowerCase());
      for (const d of [f.pantryDays, f.fridgeDays, f.freezerDays, f.openedDays]) {
        if (d !== null) expect(d).toBeGreaterThanOrEqual(0);
      }
      expect(f.defaultQuantity).toBeGreaterThan(0);
    }
  });
});

describe("matchFoodType", () => {
  const cases: [string, string][] = [
    ["WW BABY SPINACH 120G", "baby-spinach"],
    ["milk", "milk-full-cream"],
    ["Coles Beef Mince 500g", "beef-mince"],
    ["bananas", "banana"],
    ["free range eggs 12pk", "eggs"],
    ["tin tomatoes", "tinned-tomatoes"],
    ["Greek yoghurt 1kg", "greek-yoghurt"],
    ["sourdough", "sourdough"],
    ["bread", "bread-loaf"],
    ["cheese", "cheese-tasty"],
    ["mince", "beef-mince"],
    ["chicken", "chicken-breast"],
    ["Chicken Thigh Fillets 600g", "chicken-thigh"],
    ["capsicum", "capsicum-red"],
    ["zucchini", "zucchini"],
    ["Rockmelon", "rockmelon"],
    ["spring onions", "spring-onion"],
    ["kent pumpkin", "pumpkin-kent"],
    ["sweet potato", "sweet-potato"],
    ["potatoes", "potato"],
    ["onions", "onion-brown"],
    ["butter", "butter"],
    ["haloumi", "cheese-haloumi"],
    ["barramundi fillets", "barramundi"],
    ["cooked rice", "cooked-rice"],
    ["peanut butter", "peanut-butter"],
    ["vegemite", "vegemite"],
    ["tomato sauce", "tomato-sauce"],
    ["frozen peas", "frozen-peas"],
    ["leftovers - cooked meal", "leftovers-meal"],
    ["pasta", "pasta-dried"],
    ["spaghetti", "pasta-dried"],
    ["Pork sausages", "sausages"],
    ["lettuce cos", "lettuce-cos"],
    ["salt", "salt-pepper"],
    ["Cherry tomatoes 250g", "cherry-tomato"],
    ["WW LF MILK 2L", "milk-lactose-free"],
    // Drinks
    ["Mineral Water 1.25L", "mineral-water"],
    ["SCHWEPPES MINERAL WATER 1.1L", "mineral-water"],
    ["MIN WATER 1.25L", "mineral-water"],
    ["Sparkling water", "sparkling-water"],
    ["SPK WATER 1.25L", "sparkling-water"],
    ["MT FRANKLIN SPRKL WTR 1.25L", "sparkling-water"],
    ["Mount Franklin Lightly Sparkling Water 1.25L", "sparkling-water"],
    ["still water 600ml", "water"],
    ["Soda water 1.25L", "soda-water"],
    ["tonic water", "soda-water"],
    ["Coke 1.25L", "soft-drink"],
    ["SOFT DRK 2L", "soft-drink"],
    ["Coke No Sugar 1.25L", "soft-drink-diet"],
    ["COKE NO SUGAR 10X375ML", "soft-drink-diet"],
    ["Solo No Sugar 1.25L", "soft-drink-diet"],
    ["Diet coke cans 10pk", "soft-drink-diet"],
    ["Pepsi Max 1.25L", "soft-drink-diet"],
    ["Bickfords lime cordial 1L", "cordial"],
    ["Lipton Ice Tea Peach 1.5L", "iced-tea"],
    ["kombucha", "kombucha"],
    ["Red Bull 4pk", "energy-drink"],
    ["Gatorade 600ml", "sports-drink"],
    ["coconut water", "coconut-water"],
    ["orange juice", "juice-fresh"],
    ["Golden Circle apple juice 1L", "juice-long-life"],
    ["oat milk", "milk-oat"],
    ["oat milk chilled", "milk-plant-chilled"],
    ["So Good soy milk 1L", "milk-soy"],
    ["coffee beans 1kg", "coffee-beans"],
    ["Lavazza ground coffee", "coffee-ground"],
    ["nespresso pods", "coffee-pods"],
    ["Tea bags 100pk", "tea"],
    ["VB 24 x 375ml", "beer"],
    ["Shiraz", "wine-red"],
    ["Sauvignon blanc", "wine-white"],
    ["Prosecco", "wine-sparkling"],
    ["Somersby apple cider", "cider"],
    ["Bundaberg rum 700ml", "spirits"],
    ["Up & Go 6pk", "breakfast-drink"],
    // Sugar claims are not the sugar food
    ["juice no added sugar", "juice-fresh"],
    ["Greek yoghurt no added sugar 1kg", "greek-yoghurt"],
    ["sugar free gum", "chewing-gum"],
    // Freezer, pantry, snacks, bakery, dairy, meat
    ["BIRDS EYE PEAS 1KG", "frozen-peas"],
    ["frozen prawns 1kg", "frozen-prawns"],
    ["dumplings", "frozen-dumplings"],
    ["garlic bread", "garlic-bread"],
    ["bag of ice 5kg", "ice"],
    ["arborio rice", "rice-specialty"],
    ["quinoa", "quinoa"],
    ["stock cubes", "stock-cubes"],
    ["Campbells real stock chicken 1L", "stock"],
    ["mixed nuts", "trail-mix"],
    ["Doritos Cheese Supreme", "chips"],
    ["bagels", "bagels"],
    ["Wonder white", "bread-loaf"],
    ["cottage cheese", "cheese-cottage"],
    ["bocconcini", "cheese-fresh-mozzarella"],
    ["Jarlsberg cheese", "cheese-swiss"],
    ["chicken wings", "chicken-wings"],
    ["Kangaroo fillet 400g", "kangaroo-steak"],
    ["Corned silverside 1.5kg", "corned-beef"],
    ["Smoked ham hock", "ham-hock"],
    ["WW BEEF STRIPS 500G", "beef-diced"],
    ["tuna steaks", "tuna-steak"],
    ["chorizo", "chorizo"],
    ["pastry", "pastry-sheets"],
    // Added from the audit
    ["shallots", "shallot"],
    ["french shallots", "shallot"],
    ["spring onions", "spring-onion"],
    ["labneh", "labneh"],
    ["fetta", "cheese-feta"],
    ["pak choy", "bok-choy"],
    ["daikon", "daikon"],
    ["radishes", "radish"],
    // Cooked and leftover lines only match cooked food
    ["cooked lentils", "cooked-veg"],
    ["leftover lentils", "cooked-veg"],
    ["cooked potatoes", "cooked-veg"],
    ["cooked chicken", "cooked-chicken"],
    ["cooked prawns", "prawns-cooked"],
    ["leftover lasagne", "leftovers-meal"],
    ["homemade soup", "soup-cooked"],
    ["homemade pesto", "soup-cooked"],
  ];
  for (const [text, id] of cases) {
    it(`"${text}" -> ${id}`, () => {
      expect(matchFoodType(text)?.food.id).toBe(id);
    });
  }
});

describe("weak matches", () => {
  it("needs four letters for a prefix match", () => {
    expect(matchFoodType("LOL")).toBeUndefined();
    expect(matchFoodType("BABY SPIN 120G")?.food.id).toBe("baby-spinach");
  });

  it("gives whole melons, sourdough and soft herbs sensible defaults", () => {
    const f = (id: string) => FOOD_TYPES.find((x) => x.id === id)!;
    for (const id of ["watermelon", "rockmelon", "honeydew"]) expect(f(id).fridgeDays, id).toBe(10);
    expect(f("sourdough").pantryDays).toBe(4);
    expect(f("basil").defaultLocation).toBe("fridge");
    expect(f("shallot").defaultLocation).toBe("pantry");
    expect(f("cream-thickened").freezerDays).not.toBeNull();
  });
});

describe("normalise", () => {
  it("drops sizes, including litres and multipacks", () => {
    expect(normalise("Mineral Water 1.25L")).toBe("mineral water");
    expect(normalise("Coke 24 x 375ml")).toBe("coke");
    expect(normalise("Milk 2 litres")).toBe("milk");
  });

  it("turns no-sugar claims into zero and drops no-added-sugar claims", () => {
    expect(normalise("Coke No Sugar")).toBe("coke zero");
    expect(normalise("Pepsi Max Zero Sugar")).toBe("pepsi max zero");
    expect(normalise("sugar-free lemonade")).toBe("zero lemonade");
    expect(normalise("Apple juice no added sugar")).toBe("apple juice");
    expect(normalise("Raw sugar 1kg")).toBe("raw sugar");
  });
});
