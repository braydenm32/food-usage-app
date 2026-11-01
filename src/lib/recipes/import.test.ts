import { describe, expect, it } from "vitest";
import { durationMinutes, parseIngredientLine, recipeFromHtml, tablespoonFor, toCelsius } from "./import";
import { findTimers, formatClock } from "./timers";
import { formatAmount, scaleIngredient } from "./quantity";

describe("parseIngredientLine", () => {
  it("keeps ranges and splits prep notes", () => {
    expect(parseIngredientLine("6–8 tbsp butter, softened")).toMatchObject({ quantity: 6, quantityMax: 8, unit: "tbsp", name: "butter", note: "softened" });
    expect(parseIngredientLine("2 to 3 cloves garlic")).toMatchObject({ quantity: 2, quantityMax: 3, unit: "clove", name: "garlic" });
  });

  it("reads fractions and mixed numbers", () => {
    expect(parseIngredientLine("1 1/2 cups plain flour")).toMatchObject({ quantity: 1.5, unit: "cup", name: "plain flour" });
    expect(parseIngredientLine("½ tsp salt")).toMatchObject({ quantity: 0.5, unit: "tsp", name: "salt" });
    expect(parseIngredientLine("200g baby spinach")).toMatchObject({ quantity: 200, unit: "g", name: "baby spinach" });
  });

  it("converts imperial to metric", () => {
    expect(parseIngredientLine("2 lb chicken thighs")).toMatchObject({ quantity: 905, unit: "g", name: "chicken thighs" });
    expect(parseIngredientLine("8 fl oz milk")).toMatchObject({ quantity: 235, unit: "ml", name: "milk" });
  });

  it("handles tin sizes, optional items and to-taste", () => {
    expect(parseIngredientLine("1 (400g) tin diced tomatoes")).toMatchObject({ quantity: 1, unit: "tin", name: "diced tomatoes", note: "400g" });
    expect(parseIngredientLine("Fresh coriander, to serve (optional)")).toMatchObject({ name: "Fresh coriander", optional: true });
    expect(parseIngredientLine("Salt and pepper, to taste")).toMatchObject({ name: "Salt and pepper", note: "to taste" });
    expect(parseIngredientLine("Salt and pepper, to taste").quantity).toBeUndefined();
  });

  it("handles the formats reviewers caught", () => {
    expect(parseIngredientLine("1/2 cup sugar")).toMatchObject({ quantity: 0.5, unit: "cup", name: "sugar" });
    expect(parseIngredientLine("1½ cups milk")).toMatchObject({ quantity: 1.5, unit: "cup", name: "milk" });
    expect(parseIngredientLine("1 ¼ cups water")).toMatchObject({ quantity: 1.25, unit: "cup", name: "water" });
    expect(parseIngredientLine("200g/7oz butter")).toMatchObject({ quantity: 200, unit: "g", name: "butter" });
    expect(parseIngredientLine("2 x 400g cans tomatoes")).toMatchObject({ quantity: 2, unit: "tin", name: "tomatoes", note: "400g" });
    expect(parseIngredientLine("1 cup (250ml) milk")).toMatchObject({ quantity: 1, unit: "cup", name: "milk", note: "250ml" });
    expect(parseIngredientLine("1 can (14 oz) tomatoes")).toMatchObject({ unit: "tin", name: "tomatoes", note: "14 oz" });
    expect(parseIngredientLine("1 package (8 oz) cream cheese")).toMatchObject({ unit: "pack", name: "cream cheese", note: "8 oz" });
    expect(parseIngredientLine("1 onion, finely chopped (about 200g)")).toMatchObject({ name: "onion", note: "about 200g, finely chopped" });
  });

  it("doesn't treat words starting with c or t as units", () => {
    expect(parseIngredientLine("2 carrots, grated")).toMatchObject({ quantity: 2, name: "carrots", note: "grated" });
    expect(parseIngredientLine("3 tomatoes").unit).toBeUndefined();
  });
});

describe("method text", () => {
  it("adds Celsius to Fahrenheit temperatures", () => {
    expect(toCelsius("Bake at 350°F for 20 minutes")).toBe("Bake at 180°C (350°F) for 20 minutes");
    expect(toCelsius("Preheat to 200°C")).toBe("Preheat to 200°C");
  });
  it("reads ISO durations", () => {
    expect(durationMinutes("PT1H15M")).toBe(75);
    expect(durationMinutes("PT0M")).toBeUndefined();
  });
  it("knows Australian sites use 20 ml tablespoons", () => {
    expect(tablespoonFor("https://www.taste.com.au/recipes/x")).toBe(20);
    expect(tablespoonFor("https://www.example.co.nz/recipes/x")).toBe(15);
    expect(tablespoonFor("https://www.bbcgoodfood.com/recipes/x")).toBe(15);
  });
});

describe("recipeFromHtml", () => {
  const page = (data: unknown) => `<html><head><script type="application/ld+json">${JSON.stringify(data)}</script></head><body></body></html>`;

  it("finds a Recipe inside @graph and maps it", () => {
    const r = recipeFromHtml(
      page({
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "WebPage", name: "x" },
          {
            "@type": ["Recipe"],
            name: "Pumpkin soup &amp; toast",
            recipeYield: ["4", "4 serves"],
            totalTime: "PT45M",
            image: [{ url: "https://img.example/a.jpg" }],
            recipeIngredient: ["1 kg butternut pumpkin, chopped", "1 L chicken stock"],
            recipeInstructions: [
              { "@type": "HowToSection", name: "Soup", itemListElement: [{ "@type": "HowToStep", text: "Roast the pumpkin at 400°F for 30 minutes." }] },
              { "@type": "HowToStep", text: "Blend with the stock." },
            ],
            keywords: "soup, winter",
          },
        ],
      }),
      "https://www.example.com.au/soup",
    );
    expect(r).toMatchObject({
      title: "Pumpkin soup & toast",
      servings: 4,
      minutes: 45,
      image: "https://img.example/a.jpg",
      tags: ["soup", "winter"],
      tbspMl: 20,
      source: "saved",
      sourceUrl: "https://www.example.com.au/soup",
    });
    expect(r?.ingredients[0]).toMatchObject({ quantity: 1, unit: "kg", name: "butternut pumpkin", note: "chopped" });
    expect(r?.steps).toEqual(["Roast the pumpkin at 200°C (400°F) for 30 minutes.", "Blend with the stock."]);
  });

  it("splits a method given as one string", () => {
    const r = recipeFromHtml(page({ "@type": "Recipe", name: "Eggs", recipeIngredient: ["2 eggs"], recipeInstructions: "1. Boil water.\n2. Cook eggs 7 minutes." }));
    expect(r?.steps).toEqual(["Boil water.", "Cook eggs 7 minutes."]);
  });

  it("returns null without recipe data", () => {
    expect(recipeFromHtml("<html><script type='application/ld+json'>{bad json</script></html>")).toBeNull();
    expect(recipeFromHtml(page({ "@type": "Article", name: "x" }))).toBeNull();
  });
});

describe("ranges in quantities", () => {
  it("scales and formats both ends", () => {
    const s = scaleIngredient({ name: "butter", quantity: 6, quantityMax: 8, unit: "tbsp" }, 0.5);
    expect(formatAmount(s.quantity, s.unit, s.quantityMax)).toBe("3–4 tbsp");
  });
});

describe("findTimers", () => {
  it("finds times, ranges and hours", () => {
    expect(findTimers("Simmer for 25-30 minutes, stirring.")).toEqual([{ label: "25-30 minutes", seconds: 1500 }]);
    expect(findTimers("Roast for 1 hour 15 minutes")).toEqual([{ label: "1 hour 15 minutes", seconds: 4500 }]);
    expect(findTimers("Rest for a minute, then bake 20 mins")).toEqual([
      { label: "a minute", seconds: 60 },
      { label: "20 mins", seconds: 1200 },
    ]);
    expect(findTimers("Cook 1h")).toEqual([{ label: "1h", seconds: 3600 }]);
    expect(findTimers("Simmer 1½ hours")[0].seconds).toBe(5400);
    expect(findTimers("Simmer 1 1/2 hours")[0].seconds).toBe(5400);
    expect(findTimers("Braise 1h30m")[0].seconds).toBe(5400);
    expect(findTimers("Boil for 10 to 12 minutes")[0]).toEqual({ label: "10 to 12 minutes", seconds: 600 });
  });
  it("ignores things that aren't times", () => {
    expect(findTimers("Add 2 m of string")).toEqual([]);
    expect(findTimers("Cut into 3 cm pieces")).toEqual([]);
  });
  it("formats a clock", () => {
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(3725)).toBe("1:02:05");
  });
});
