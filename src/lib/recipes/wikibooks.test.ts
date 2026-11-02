import { describe, expect, it } from "vitest";
import { cleanWikitext, recipeFromWikibooks, recipeSummaryFields, wikiMinutes } from "./wikibooks";

const PAGE = `{{Recipe summary
| category = Vegetarian recipes
| servings = 4 people
| time = 1 hour 15 minutes
| difficulty = 2
| image = [[File:Lentil soup.jpg|300px|A bowl of [[Cookbook:Lentil|lentil]] soup]]
}}
{{recipe}} | [[Cookbook:Soup|Soup]]

'''Lentil soup''' is a hearty soup made with [[Cookbook:Lentil|lentils]] and vegetables.<ref>Some book</ref>

== Ingredients ==
* 1 [[Cookbook:Cup|cup]] (200 [[Cookbook:Gram|g]]) red [[Cookbook:Lentil|lentils]]
* 1 [[Cookbook:Onion|onion]], [[Cookbook:Dice|diced]]
* 2 [[Cookbook:Carrot|carrots]], chopped
=== For serving ===
* [[Cookbook:Parsley|Parsley]] (optional)

== Procedure ==
# [[Cookbook:Sauté|Sauté]] the onion in a little oil until soft.
# Add the lentils, carrots and 1 [[Cookbook:Litre|litre]] of water.
#: This continuation line is skipped.
# [[Cookbook:Simmer|Simmer]] for 25&nbsp;minutes.

== Notes, tips, and variations ==
* Add cumin.

[[Category:Recipes using lentils]]
[[Category:Soup recipes]]`;

describe("cleanWikitext", () => {
  it("keeps link labels and drops markup", () => {
    expect(cleanWikitext("'''Mix''' the [[Cookbook:Flour|flour]] and [[Cookbook:Sugar]]{{convert|1|cup}}.")).toBe("Mix the flour and Sugar.");
    expect(cleanWikitext("[[File:x.jpg|thumb|A [[cake]]]]Cake")).toBe("Cake");
    expect(cleanWikitext("See [https://example.com the site] now")).toBe("See the site now");
  });
});

describe("wikiMinutes", () => {
  it("reads common time phrasings", () => {
    expect(wikiMinutes("1 hour 15 minutes")).toBe(75);
    expect(wikiMinutes("45 min")).toBe(45);
    expect(wikiMinutes("1½ hours")).toBe(90);
    expect(wikiMinutes("2–3 hours")).toBe(120);
    expect(wikiMinutes("overnight")).toBeUndefined();
  });
});

describe("recipeSummaryFields", () => {
  it("handles nested links and templates", () => {
    const f = recipeSummaryFields(PAGE);
    expect(f.servings).toBe("4 people");
    expect(f.category).toBe("Vegetarian recipes");
    expect(f.image).toContain("Lentil soup.jpg");
  });
});

describe("recipeFromWikibooks", () => {
  it("parses a Cookbook page with credit and licence", () => {
    const r = recipeFromWikibooks({ title: "Cookbook:Lentil Soup", wikitext: PAGE });
    expect(r).not.toBeNull();
    expect(r!.id).toBe("wb-lentil-soup");
    expect(r!.title).toBe("Lentil Soup");
    expect(r!.servings).toBe(4);
    expect(r!.minutes).toBe(75);
    expect(r!.ingredients.map((i) => i.name.toLowerCase())).toEqual(["red lentils", "onion", "carrots", "parsley"]);
    expect(r!.ingredients[3].optional).toBe(true);
    expect(r!.steps).toEqual([
      "Sauté the onion in a little oil until soft.",
      "Add the lentils, carrots and 1 litre of water.",
      "Simmer for 25 minutes.",
    ]);
    expect(r!.tags).toEqual(expect.arrayContaining(["vegetarian", "soup"]));
    expect(r!.summary).toMatch(/^Lentil soup is a hearty soup/);
    expect(r!.image).toBeUndefined();
    expect(r!.credit).toEqual({
      name: "Wikibooks Cookbook",
      url: "https://en.wikibooks.org/wiki/Cookbook:Lentil_Soup",
      licence: "CC BY-SA 4.0",
      licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      authorsUrl: "https://en.wikibooks.org/wiki/Cookbook:Lentil_Soup?action=history",
      changes: "Reformatted for Larder",
    });
  });

  it("skips pages that aren't usable recipes", () => {
    expect(recipeFromWikibooks({ title: "Cookbook:Onion", wikitext: "An onion is a vegetable.\n== Uses ==\n* Soup" })).toBeNull();
    expect(recipeFromWikibooks({ title: "Cookbook:X", wikitext: "#REDIRECT [[Cookbook:Y]]" })).toBeNull();
    const tableIngredients = "== Ingredients ==\n{| class=wikitable\n| flour || 1 cup\n|}\n== Procedure ==\n# Mix.\n# Bake it.";
    expect(recipeFromWikibooks({ title: "Cookbook:Z", wikitext: tableIngredients })).toBeNull();
  });
});
