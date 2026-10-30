import type { Recipe, RecipeIngredient } from "@/lib/types";
import { matchFoodType } from "@/lib/shelf-life/foods";

/** [name, quantity, unit, optional?] */
type Ing = [name: string, quantity?: number, unit?: string, optional?: boolean];

/** Where the fuzzy matcher picks a poorer food type than the one households actually store. */
const OVERRIDES: Record<string, string | null> = {
  spaghetti: "pasta-dried",
  "small pasta": "pasta-dried",
  "arborio rice": "rice-white",
  "cooked potato": "potato",
};

const cache = new Map<string, string | null>();
function foodTypeIdFor(name: string): string | null {
  if (cache.has(name)) return cache.get(name) ?? null;
  const m = matchFoodType(name);
  const id = name in OVERRIDES ? OVERRIDES[name] : m && m.score >= 45 ? m.food.id : null;
  cache.set(name, id);
  return id;
}

export function toIngredient([name, quantity, unit, optional]: Ing): RecipeIngredient {
  return { name, quantity, unit, optional: optional || undefined, foodTypeId: foodTypeIdFor(name) };
}

function recipe(
  slug: string,
  title: string,
  o: { servings: number; minutes: number; tags: string[]; summary: string; ingredients: Ing[]; steps: string[] },
): Recipe {
  return {
    id: `builtin-${slug}`,
    title,
    source: "builtin",
    servings: o.servings,
    minutes: o.minutes,
    tags: o.tags,
    summary: o.summary,
    ingredients: o.ingredients.map(toIngredient),
    steps: o.steps,
  };
}

export const BUILTIN_RECIPES: Recipe[] = [
  recipe("spag-bol", "Spaghetti bolognese", {
    servings: 4, minutes: 45, tags: ["dinner", "kid-friendly", "freezer-friendly"],
    summary: "The Tuesday-night classic. Hides a lot of tired veg.",
    ingredients: [["beef mince", 500, "g"], ["brown onion", 1, "item"], ["carrot", 1, "item"], ["garlic", 2, "clove"], ["tinned tomatoes", 400, "g"], ["pasta sauce", 250, "g"], ["spaghetti", 320, "g"], ["tasty cheese", 40, "g", true], ["olive oil", 1, "tbsp"]],
    steps: ["Heat the oil in a large pan. Soften the diced onion, grated carrot and garlic for 5 minutes.", "Add the mince and brown well, breaking it up as it cooks.", "Stir in the tomatoes and pasta sauce, then simmer for 20 minutes until thick.", "Cook the spaghetti in salted water until al dente. Drain and toss through the sauce.", "Serve with grated cheese."],
  }),
  recipe("fried-rice", "Egg fried rice", {
    servings: 4, minutes: 15, tags: ["quick", "dinner", "uses-leftovers"],
    summary: "Best with day-old rice and whatever veg needs using.",
    ingredients: [["cooked rice", 600, "g"], ["eggs", 3, "item"], ["frozen peas", 100, "g"], ["carrot", 1, "item"], ["spring onion", 2, "item"], ["bacon", 100, "g", true], ["soy sauce", 2, "tbsp"], ["vegetable oil", 2, "tbsp"]],
    steps: ["Heat half the oil in a wok over high heat. Scramble the eggs, then tip them out.", "Add the remaining oil, then the diced bacon and carrot. Stir-fry for 3 minutes.", "Add the rice and peas and toss until piping hot.", "Return the egg, add soy sauce and sliced spring onion, and toss to combine."],
  }),
  recipe("banana-bread", "Banana bread", {
    servings: 10, minutes: 70, tags: ["baking", "vegetarian", "freezer-friendly", "uses-ripe-fruit"],
    summary: "The best home for bananas with freckles.",
    ingredients: [["bananas", 3, "item"], ["plain flour", 225, "g"], ["eggs", 2, "item"], ["butter", 100, "g"], ["brown sugar", 100, "g"], ["baking powder", 2, "tsp"], ["milk", 60, "ml"]],
    steps: ["Heat the oven to 170°C fan-forced and line a loaf tin.", "Mash the bananas, then beat in the melted butter, sugar, eggs and milk.", "Fold in the flour and baking powder until just combined.", "Pour into the tin and bake for 50 to 55 minutes, until a skewer comes out clean.", "Cool in the tin for 10 minutes before slicing."],
  }),
  recipe("frittata", "Clear-out-the-fridge frittata", {
    servings: 4, minutes: 30, tags: ["vegetarian", "gluten-free", "quick", "uses-leftovers", "dinner"],
    summary: "Eggs, cheese and any tired veg. Great hot or cold.",
    ingredients: [["eggs", 8, "item"], ["baby spinach", 60, "g"], ["zucchini", 1, "item"], ["tasty cheese", 80, "g"], ["brown onion", 1, "item"], ["milk", 60, "ml"], ["olive oil", 1, "tbsp"]],
    steps: ["Heat the oven grill to medium-high.", "Soften the sliced onion and zucchini in an ovenproof pan with the oil for 5 minutes. Add the spinach until wilted.", "Whisk the eggs with the milk and half the cheese. Pour into the pan.", "Cook on low for 5 minutes until the edges set, scatter with the rest of the cheese and grill for 5 minutes until golden.", "Rest for 5 minutes, then slice."],
  }),
  recipe("veg-stir-fry", "Veggie stir-fry", {
    servings: 3, minutes: 20, tags: ["vegetarian", "vegan", "quick", "dinner", "uses-leftovers"],
    summary: "Any crunchy veg, a fast sauce, and noodles or rice.",
    ingredients: [["broccoli", 1, "item"], ["capsicum", 1, "item"], ["carrot", 1, "item"], ["garlic", 2, "clove"], ["ginger", 1, "tsp"], ["soy sauce", 3, "tbsp"], ["rice", 300, "g"], ["vegetable oil", 1, "tbsp"]],
    steps: ["Cook the rice according to the packet.", "Heat the oil in a wok on high. Fry the garlic and ginger for 30 seconds.", "Add the hard veg (carrot, broccoli) first, then the capsicum. Stir-fry for 4 to 5 minutes.", "Add the soy sauce and a splash of water, toss for a minute and serve over the rice."],
  }),
  recipe("chicken-curry", "Easy chicken curry", {
    servings: 4, minutes: 35, tags: ["dinner", "gluten-free", "dairy-free", "freezer-friendly"],
    summary: "A mild, creamy weeknight curry with a jar of paste.",
    ingredients: [["chicken thigh", 600, "g"], ["brown onion", 1, "item"], ["curry paste", 3, "tbsp"], ["coconut milk", 400, "ml"], ["potato", 2, "item"], ["frozen peas", 100, "g"], ["rice", 300, "g"]],
    steps: ["Brown the chopped chicken in a pot, then lift out.", "Soften the onion, add the curry paste and stir for a minute.", "Add the coconut milk, diced potato and chicken. Simmer for 20 minutes.", "Stir through the peas for the last 3 minutes. Serve with steamed rice."],
  }),
  recipe("san-choy-bow", "San choy bow", {
    servings: 4, minutes: 25, tags: ["dairy-free", "quick", "dinner"],
    summary: "Sticky pork or chicken mince in crisp lettuce cups.",
    ingredients: [["pork mince", 500, "g"], ["iceberg lettuce", 1, "item"], ["carrot", 1, "item"], ["spring onion", 3, "item"], ["garlic", 2, "clove"], ["hoisin sauce", 3, "tbsp"], ["soy sauce", 1, "tbsp"]],
    steps: ["Separate the lettuce leaves, wash and keep them whole as cups.", "Fry the mince on high heat until browned and crisp at the edges.", "Add the garlic, grated carrot, hoisin and soy. Cook for 3 minutes.", "Stir through half the spring onion, spoon into the lettuce cups and top with the rest."],
  }),
  recipe("minestrone", "Minestrone", {
    servings: 6, minutes: 45, tags: ["vegetarian", "vegan", "freezer-friendly", "dinner", "uses-leftovers"],
    summary: "A big pot that clears the veg drawer and freezes well.",
    ingredients: [["brown onion", 1, "item"], ["carrot", 2, "item"], ["celery", 2, "item"], ["zucchini", 1, "item"], ["tinned tomatoes", 400, "g"], ["cannellini beans", 400, "g"], ["small pasta", 100, "g"], ["vegetable stock", 1, "L"], ["olive oil", 2, "tbsp"]],
    steps: ["Soften the diced onion, carrot and celery in the oil for 8 minutes.", "Add the tomatoes and stock and bring to the boil.", "Add the zucchini, beans and pasta. Simmer for 12 minutes until the pasta is tender.", "Season well and serve with crusty bread."],
  }),
  recipe("shakshuka", "Shakshuka", {
    servings: 3, minutes: 30, tags: ["vegetarian", "gluten-free", "dairy-free", "quick", "dinner"],
    summary: "Eggs poached in a spiced tomato and capsicum sauce.",
    ingredients: [["eggs", 6, "item"], ["tinned tomatoes", 800, "g"], ["capsicum", 1, "item"], ["brown onion", 1, "item"], ["garlic", 2, "clove"], ["ground cumin", 2, "tsp"], ["smoked paprika", 1, "tsp"], ["olive oil", 1, "tbsp"], ["feta", 60, "g", true]],
    steps: ["Soften the onion and capsicum in the oil for 6 minutes. Add the garlic and spices.", "Add the tomatoes and simmer for 10 minutes until thick.", "Make six wells, crack in the eggs, cover and cook for 5 to 6 minutes until just set.", "Top with crumbled feta and serve with bread."],
  }),
  recipe("pumpkin-soup", "Roast pumpkin soup", {
    servings: 6, minutes: 55, tags: ["vegetarian", "gluten-free", "freezer-friendly", "dinner"],
    summary: "Smooth, sweet and a good way to finish a half pumpkin.",
    ingredients: [["pumpkin", 1, "kg"], ["brown onion", 1, "item"], ["garlic", 2, "clove"], ["vegetable stock", 800, "ml"], ["cream", 100, "ml", true], ["olive oil", 2, "tbsp"]],
    steps: ["Roast the chopped pumpkin with half the oil at 200°C for 30 minutes.", "Soften the onion and garlic in the remaining oil in a pot.", "Add the pumpkin and stock, simmer for 10 minutes, then blend until smooth.", "Stir in the cream if using, and season."],
  }),
  recipe("smoothie", "Banana berry smoothie", {
    servings: 2, minutes: 5, tags: ["vegetarian", "gluten-free", "quick", "breakfast", "uses-ripe-fruit"],
    summary: "Freckled bananas, yoghurt and whatever fruit is going soft.",
    ingredients: [["bananas", 2, "item"], ["greek yoghurt", 200, "g"], ["milk", 250, "ml"], ["frozen berries", 100, "g", true], ["honey", 1, "tbsp", true]],
    steps: ["Peel the bananas (freeze them first for a thicker smoothie).", "Blend everything until smooth, adding a splash more milk if it is too thick.", "Pour into two glasses and drink straight away."],
  }),
  recipe("nachos", "Loaded beef nachos", {
    servings: 4, minutes: 30, tags: ["dinner", "gluten-free", "kid-friendly"],
    summary: "Corn chips, spiced mince, melty cheese. Fine with avocado past its best.",
    ingredients: [["beef mince", 400, "g"], ["corn chips", 200, "g"], ["tinned tomatoes", 400, "g"], ["kidney beans", 400, "g"], ["tasty cheese", 150, "g"], ["avocado", 1, "item"], ["sour cream", 100, "g", true], ["taco seasoning", 2, "tbsp"]],
    steps: ["Heat the oven to 200°C. Brown the mince, add the taco seasoning, tomatoes and beans and simmer for 10 minutes.", "Spread the chips on a tray, spoon over the mince and cover with grated cheese.", "Bake for 8 to 10 minutes until the cheese bubbles.", "Top with mashed avocado and sour cream."],
  }),
  recipe("zucchini-slice", "Zucchini slice", {
    servings: 6, minutes: 45, tags: ["vegetarian", "quick-prep", "freezer-friendly", "lunch"],
    summary: "An Aussie lunchbox favourite. Squeeze the zucchini well.",
    ingredients: [["zucchini", 3, "item"], ["eggs", 6, "item"], ["bacon", 150, "g", true], ["tasty cheese", 120, "g"], ["self-raising flour", 150, "g"], ["brown onion", 1, "item"], ["vegetable oil", 80, "ml"]],
    steps: ["Heat the oven to 180°C fan-forced and line a slice tin.", "Grate the zucchini and squeeze out the liquid. Mix with the diced onion, bacon and most of the cheese.", "Whisk the eggs, oil and flour, then stir through the zucchini mix.", "Pour into the tin, top with the remaining cheese and bake for 30 minutes until golden and set."],
  }),
  recipe("chicken-schnitzel", "Chicken schnitzel", {
    servings: 4, minutes: 30, tags: ["dinner", "kid-friendly", "dairy-free"],
    summary: "Crumbed, shallow-fried and ready with a squeeze of lemon.",
    ingredients: [["chicken breast", 600, "g"], ["plain flour", 60, "g"], ["eggs", 2, "item"], ["breadcrumbs", 150, "g"], ["lemon", 1, "item"], ["vegetable oil", 120, "ml"], ["salad leaves", 100, "g", true]],
    steps: ["Slice the chicken breasts in half horizontally and pound to an even 1 cm.", "Dust with flour, dip in beaten egg, then press into breadcrumbs.", "Shallow-fry in hot oil for 3 minutes each side until golden and cooked through.", "Drain on paper towel and serve with lemon wedges and salad."],
  }),
  recipe("tuna-pasta-bake", "Tuna pasta bake", {
    servings: 4, minutes: 40, tags: ["dinner", "kid-friendly", "pantry-meal"],
    summary: "Mostly tins and a bit of cheese. A good no-shop dinner.",
    ingredients: [["penne", 300, "g"], ["tinned tuna", 425, "g"], ["pasta sauce", 400, "g"], ["frozen peas", 100, "g"], ["tasty cheese", 100, "g"], ["breadcrumbs", 40, "g", true]],
    steps: ["Heat the oven to 200°C. Cook the pasta for 2 minutes less than the packet says.", "Mix the pasta with the drained tuna, pasta sauce and peas in a baking dish.", "Top with cheese and breadcrumbs.", "Bake for 20 minutes until golden and bubbling."],
  }),
  recipe("omelette", "Cheese and spinach omelette", {
    servings: 1, minutes: 8, tags: ["vegetarian", "gluten-free", "quick", "breakfast", "lunch"],
    summary: "Two minutes of effort for a proper meal.",
    ingredients: [["eggs", 3, "item"], ["baby spinach", 30, "g"], ["tasty cheese", 30, "g"], ["butter", 10, "g"]],
    steps: ["Beat the eggs with a pinch of salt.", "Melt the butter in a non-stick pan over medium heat and pour in the eggs.", "As they set, push the edges to the centre. Scatter over the spinach and cheese.", "Fold in half, cook for another 30 seconds and slide onto a plate."],
  }),
  recipe("beef-tacos", "Beef tacos", {
    servings: 4, minutes: 25, tags: ["dinner", "kid-friendly", "quick"],
    summary: "Build-your-own tacos with whatever salad needs using.",
    ingredients: [["beef mince", 500, "g"], ["taco shells", 8, "item"], ["taco seasoning", 2, "tbsp"], ["tomato", 2, "item"], ["iceberg lettuce", 0.5, "item"], ["tasty cheese", 80, "g"], ["avocado", 1, "item", true], ["sour cream", 100, "g", true]],
    steps: ["Brown the mince in a pan, stir in the seasoning and 1/3 cup of water, and simmer for 5 minutes.", "Warm the taco shells in the oven for 3 minutes.", "Dice the tomato, shred the lettuce and grate the cheese.", "Fill the shells and add toppings."],
  }),
  recipe("lentil-dahl", "Red lentil dahl", {
    servings: 4, minutes: 35, tags: ["vegetarian", "vegan", "gluten-free", "dairy-free", "freezer-friendly", "dinner"],
    summary: "Cheap, filling and almost entirely from the pantry.",
    ingredients: [["red lentils", 200, "g"], ["brown onion", 1, "item"], ["garlic", 3, "clove"], ["curry powder", 2, "tbsp"], ["tinned tomatoes", 400, "g"], ["coconut milk", 200, "ml"], ["baby spinach", 60, "g", true], ["vegetable oil", 1, "tbsp"]],
    steps: ["Soften the onion and garlic in the oil, then stir in the curry powder for a minute.", "Add the rinsed lentils, tomatoes and 2 cups of water. Simmer for 20 minutes, stirring now and then.", "Stir through the coconut milk and spinach until wilted.", "Serve with rice or flatbread."],
  }),
  recipe("banana-pancakes", "Banana pancakes", {
    servings: 3, minutes: 20, tags: ["vegetarian", "breakfast", "kid-friendly", "uses-ripe-fruit"],
    summary: "Fluffy pancakes sweetened by overripe bananas.",
    ingredients: [["bananas", 2, "item"], ["self-raising flour", 150, "g"], ["eggs", 1, "item"], ["milk", 200, "ml"], ["butter", 20, "g"], ["maple syrup", 2, "tbsp", true]],
    steps: ["Mash the bananas and whisk with the egg and milk.", "Stir in the flour until just combined; a few lumps are fine.", "Melt a little butter in a pan over medium heat and cook 1/4 cup scoops for 2 minutes each side.", "Serve with syrup and sliced banana."],
  }),
  recipe("sausage-casserole", "Sausage and veg casserole", {
    servings: 4, minutes: 50, tags: ["dinner", "dairy-free", "freezer-friendly", "uses-leftovers"],
    summary: "Slow-simmered snags with root veg in a tomato gravy.",
    ingredients: [["beef sausages", 8, "item"], ["potato", 3, "item"], ["carrot", 2, "item"], ["brown onion", 1, "item"], ["tinned tomatoes", 400, "g"], ["frozen peas", 100, "g"], ["beef stock", 250, "ml"]],
    steps: ["Brown the sausages in a large pot, then slice them into chunks.", "Soften the onion, then add the chopped potato, carrot, tomatoes and stock.", "Return the sausages and simmer, covered, for 30 minutes.", "Add the peas for the last 5 minutes."],
  }),
  recipe("chicken-veg-soup", "Chicken and vegetable soup", {
    servings: 6, minutes: 40, tags: ["dinner", "dairy-free", "freezer-friendly", "uses-leftovers"],
    summary: "Comfort in a bowl, built from fridge leftovers.",
    ingredients: [["chicken thigh", 400, "g"], ["brown onion", 1, "item"], ["carrot", 2, "item"], ["celery", 2, "item"], ["potato", 1, "item"], ["chicken stock", 1.5, "L"], ["small pasta", 80, "g", true]],
    steps: ["Soften the diced onion, carrot and celery in a large pot.", "Add the stock, chicken and diced potato. Simmer for 20 minutes.", "Lift out the chicken, shred it and return to the pot with the pasta.", "Cook for 8 minutes more and season."],
  }),
  recipe("mushroom-risotto", "Mushroom risotto", {
    servings: 4, minutes: 40, tags: ["vegetarian", "gluten-free", "dinner"],
    summary: "Stir slowly and it rewards you.",
    ingredients: [["arborio rice", 300, "g"], ["mushrooms", 250, "g"], ["brown onion", 1, "item"], ["garlic", 2, "clove"], ["vegetable stock", 1, "L"], ["parmesan", 40, "g"], ["butter", 30, "g"]],
    steps: ["Keep the stock hot in a small pot.", "Fry the sliced mushrooms in half the butter until golden, then set aside.", "Soften the onion and garlic in the remaining butter, add the rice and stir for a minute.", "Add stock a ladle at a time, stirring, until the rice is creamy, about 20 minutes.", "Stir in the mushrooms and parmesan."],
  }),
  recipe("stuffed-capsicums", "Stuffed capsicums", {
    servings: 4, minutes: 55, tags: ["gluten-free", "dinner", "uses-leftovers"],
    summary: "Mince and rice baked in capsicum cups.",
    ingredients: [["capsicum", 4, "item"], ["beef mince", 400, "g"], ["cooked rice", 300, "g"], ["pasta sauce", 250, "g"], ["tasty cheese", 80, "g"], ["brown onion", 1, "item"]],
    steps: ["Heat the oven to 190°C. Halve the capsicums and scoop out the seeds.", "Brown the onion and mince, then stir in the rice and pasta sauce.", "Fill the capsicums, top with cheese and bake in a tray for 30 minutes."],
  }),
  recipe("greek-salad", "Greek-style salad", {
    servings: 4, minutes: 10, tags: ["vegetarian", "gluten-free", "quick", "lunch"],
    summary: "Crunchy, salty and zero cooking.",
    ingredients: [["cucumber", 2, "item"], ["tomato", 3, "item"], ["red onion", 0.5, "item"], ["feta", 150, "g"], ["kalamata olives", 80, "g", true], ["olive oil", 3, "tbsp"], ["lemon", 1, "item"]],
    steps: ["Chop the cucumber and tomato into chunky pieces and thinly slice the onion.", "Toss with the olives and oil, then squeeze over the lemon.", "Crumble the feta over the top."],
  }),
  recipe("chickpea-curry", "Sweet potato and chickpea curry", {
    servings: 4, minutes: 35, tags: ["vegetarian", "vegan", "gluten-free", "dairy-free", "freezer-friendly", "dinner"],
    summary: "Hearty, mild and made mostly from tins.",
    ingredients: [["sweet potato", 500, "g"], ["chickpeas", 400, "g"], ["brown onion", 1, "item"], ["curry paste", 3, "tbsp"], ["coconut milk", 400, "ml"], ["baby spinach", 60, "g"], ["rice", 300, "g"]],
    steps: ["Soften the onion, stir in the curry paste for a minute.", "Add the diced sweet potato, coconut milk and half a cup of water. Simmer for 15 minutes.", "Add the drained chickpeas and cook for 5 minutes more.", "Wilt the spinach through and serve over rice."],
  }),
  recipe("tomato-pasta", "Garlicky tomato pasta", {
    servings: 3, minutes: 20, tags: ["vegetarian", "vegan", "quick", "pantry-meal", "dinner"],
    summary: "When there is nothing in the house, there is this.",
    ingredients: [["spaghetti", 250, "g"], ["tinned tomatoes", 400, "g"], ["garlic", 3, "clove"], ["olive oil", 2, "tbsp"], ["basil", 1, "bunch", true], ["parmesan", 30, "g", true]],
    steps: ["Cook the spaghetti until al dente and keep a cup of the pasta water.", "Gently fry the sliced garlic in the oil for a minute, add the tomatoes and simmer for 10 minutes.", "Toss the pasta through the sauce with a splash of pasta water.", "Top with torn basil and parmesan."],
  }),
  recipe("avo-eggs-toast", "Smashed avo and eggs on toast", {
    servings: 2, minutes: 10, tags: ["vegetarian", "quick", "breakfast", "lunch"],
    summary: "The café classic, for the avocado that is ready right now.",
    ingredients: [["avocado", 1, "item"], ["eggs", 4, "item"], ["sourdough", 4, "item"], ["lemon", 0.5, "item"], ["feta", 40, "g", true]],
    steps: ["Poach or fry the eggs the way you like them.", "Toast the bread. Mash the avocado with a squeeze of lemon, salt and pepper.", "Pile the avocado on the toast, top with the eggs and crumble over feta."],
  }),
  recipe("cottage-pie", "Cottage pie", {
    servings: 5, minutes: 70, tags: ["dinner", "kid-friendly", "freezer-friendly"],
    summary: "Mince and veg under a lid of buttery mash.",
    ingredients: [["beef mince", 500, "g"], ["potato", 800, "g"], ["brown onion", 1, "item"], ["carrot", 2, "item"], ["frozen peas", 100, "g"], ["beef stock", 250, "ml"], ["butter", 40, "g"], ["milk", 80, "ml"]],
    steps: ["Boil the peeled, chopped potatoes until soft, then mash with the butter and milk.", "Brown the onion, carrot and mince, add the stock and simmer for 15 minutes. Stir in the peas.", "Spoon the mince into a baking dish and top with mash. Rough up the top with a fork.", "Bake at 200°C for 25 minutes until golden."],
  }),
  recipe("potato-leek-soup", "Potato and leek soup", {
    servings: 5, minutes: 40, tags: ["vegetarian", "gluten-free", "freezer-friendly", "dinner"],
    summary: "Silky and cheap. Good with a heel of bread.",
    ingredients: [["potato", 600, "g"], ["leek", 2, "item"], ["garlic", 2, "clove"], ["vegetable stock", 1, "L"], ["milk", 150, "ml"], ["butter", 30, "g"]],
    steps: ["Soften the sliced leek and garlic in the butter for 8 minutes.", "Add the diced potato and stock and simmer for 20 minutes.", "Blend until smooth, stir in the milk and season."],
  }),
  recipe("beef-stir-fry", "Beef and broccoli stir-fry", {
    servings: 3, minutes: 20, tags: ["dairy-free", "quick", "dinner"],
    summary: "Fast, glossy and lovely over rice.",
    ingredients: [["beef strips", 400, "g"], ["broccoli", 1, "item"], ["garlic", 2, "clove"], ["soy sauce", 3, "tbsp"], ["oyster sauce", 2, "tbsp"], ["rice", 300, "g"], ["vegetable oil", 1, "tbsp"]],
    steps: ["Cook the rice.", "Sear the beef in a very hot wok in two batches, then set aside.", "Stir-fry the broccoli and garlic with a splash of water for 3 minutes.", "Return the beef, add the sauces and toss for a minute."],
  }),
  recipe("french-toast", "French toast", {
    servings: 3, minutes: 15, tags: ["vegetarian", "breakfast", "kid-friendly", "uses-leftovers"],
    summary: "A kind second life for stale bread.",
    ingredients: [["bread", 6, "item"], ["eggs", 3, "item"], ["milk", 120, "ml"], ["butter", 20, "g"], ["cinnamon", 1, "tsp", true], ["bananas", 1, "item", true]],
    steps: ["Whisk the eggs, milk and cinnamon in a shallow dish.", "Soak each slice for about 20 seconds per side.", "Fry in butter over medium heat until golden on both sides.", "Serve with sliced banana."],
  }),
  recipe("bubble-and-squeak", "Bubble and squeak", {
    servings: 3, minutes: 25, tags: ["vegetarian", "gluten-free", "quick", "uses-leftovers", "lunch"],
    summary: "Leftover mash and veg, fried until crisp, with an egg on top.",
    ingredients: [["cooked potato", 400, "g"], ["cabbage", 200, "g"], ["brown onion", 1, "item"], ["eggs", 3, "item"], ["butter", 20, "g"]],
    steps: ["Soften the sliced onion and shredded cabbage in the butter.", "Mix with the mashed or chopped potato and press into a flat cake in the pan.", "Cook for 6 minutes each side until crisp.", "Top with fried eggs."],
  }),
  recipe("fish-tacos", "Crumbed fish wraps", {
    servings: 4, minutes: 25, tags: ["dinner", "kid-friendly", "quick"],
    summary: "Crunchy fish, slaw and a squeeze of lime in a warm wrap.",
    ingredients: [["fish fillets", 500, "g"], ["breadcrumbs", 100, "g"], ["eggs", 1, "item"], ["wraps", 8, "item"], ["cabbage", 150, "g"], ["lime", 1, "item"], ["mayonnaise", 3, "tbsp"]],
    steps: ["Cut the fish into strips, dip in beaten egg and coat in breadcrumbs.", "Bake at 220°C for 12 minutes, turning once, until golden.", "Mix the shredded cabbage with mayo and a squeeze of lime.", "Warm the wraps, fill with fish and slaw."],
  }),
];

const BY_ID = new Map(BUILTIN_RECIPES.map((r) => [r.id, r]));
export function getBuiltinRecipe(id: string): Recipe | undefined {
  return BY_ID.get(id);
}
