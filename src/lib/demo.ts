import type { PantryItem } from "@/lib/types";
import { matchFoodType } from "@/lib/shelf-life/foods";
import { uid } from "@/lib/store";

/** A believable week-old shop, so a new user can see how the app behaves. */
const DEMO: Array<{ text: string; daysAgo: number; qty?: number; price?: number; opened?: number; location?: string }> = [
  { text: "baby spinach", daysAgo: 4, price: 3.5 },
  { text: "beef mince", daysAgo: 1, price: 7.5 },
  { text: "full cream milk", daysAgo: 6, price: 3.1, opened: 4 },
  { text: "greek yoghurt", daysAgo: 8, price: 6 },
  { text: "bananas", daysAgo: 5, price: 3.6 },
  { text: "avocado", daysAgo: 3, qty: 2, price: 3 },
  { text: "chicken thigh", daysAgo: 2, price: 9 },
  { text: "tasty cheese", daysAgo: 10, price: 8, opened: 7 },
  { text: "eggs", daysAgo: 9, price: 6.2 },
  { text: "broccoli", daysAgo: 6, price: 2.5 },
  { text: "pasta sauce", daysAgo: 20, price: 3.5, opened: 3 },
  { text: "sourdough", daysAgo: 3, price: 6.5 },
  { text: "frozen peas", daysAgo: 30, price: 2.5 },
  { text: "rice", daysAgo: 40, price: 4 },
  { text: "tinned tomatoes", daysAgo: 25, qty: 2, price: 2.2 },
];

export function demoItems(): PantryItem[] {
  const now = Date.now();
  return DEMO.map((d) => {
    const food = matchFoodType(d.text)?.food;
    const addedAt = new Date(now - d.daysAgo * 86_400_000).toISOString();
    const quantity = d.qty ?? food?.defaultQuantity ?? 1;
    const location = d.location ?? food?.defaultLocation ?? "fridge";
    return {
      id: uid(),
      name: food?.name ?? d.text,
      foodTypeId: food?.id ?? null,
      emoji: food?.emoji ?? "🍽️",
      locationId: location,
      quantity,
      initialQuantity: quantity,
      unit: food?.defaultUnit ?? "item",
      price: d.price,
      addedAt,
      dateKind: food?.dateKind ?? "best-before",
      openedAt: d.opened ? new Date(now - d.opened * 86_400_000).toISOString() : undefined,
      frozenAt: location === "freezer" ? addedAt : undefined,
      source: "manual",
    } satisfies PantryItem;
  });
}
