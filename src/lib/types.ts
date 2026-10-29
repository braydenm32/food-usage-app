// Core domain types for Larder. Everything the app stores lives in these shapes.

export type LocationId = string; // "pantry" | "fridge" | "freezer" | custom ids

export interface StorageLocation {
  id: LocationId;
  name: string;
  /** Which shelf-life column applies to items stored here. */
  kind: "pantry" | "fridge" | "freezer";
  emoji?: string;
}

export type DateKind = "use-by" | "best-before";

export type FoodCategory =
  | "fruit"
  | "vegetables"
  | "herbs"
  | "meat"
  | "seafood"
  | "dairy"
  | "eggs"
  | "deli"
  | "bakery"
  | "pantry"
  | "frozen"
  | "drinks"
  | "condiments"
  | "snacks"
  | "other";

/** Supermarket aisle used to group the shopping list. */
export type Aisle =
  | "Fruit & Veg"
  | "Meat & Seafood"
  | "Deli"
  | "Dairy, Eggs & Fridge"
  | "Bakery"
  | "Pantry"
  | "Freezer"
  | "Drinks"
  | "Health & Beauty"
  | "Household"
  | "Other";

/**
 * One row of the shelf-life table. Days are approximate averages from
 * Australian food-safety guidance. null means "not recommended / not applicable".
 */
export interface FoodType {
  id: string; // kebab-case, e.g. "baby-spinach"
  name: string; // display name, Australian English
  aliases: string[]; // lowercase alternative names and receipt abbreviations
  category: FoodCategory;
  aisle: Aisle;
  emoji: string;
  dateKind: DateKind;
  /** Where it should go when first added. */
  defaultLocation: "pantry" | "fridge" | "freezer";
  pantryDays: number | null;
  fridgeDays: number | null;
  freezerDays: number | null;
  /** Shelf life once opened (stored in fridge unless pantryOpened is true). */
  openedDays: number | null;
  /** Days after thawing, kept in the fridge. */
  thawedDays?: number | null;
  defaultUnit: Unit;
  defaultQuantity: number;
  /** Staples are suggested for the shopping list when they run out. */
  staple?: boolean;
  tip?: string;
}

export type Unit = "item" | "g" | "kg" | "ml" | "L" | "pack" | "bunch" | "dozen" | "loaf" | "tin" | "jar" | "bottle";

export type ItemStatus = "fresh" | "use-soon" | "use-today" | "expired";

export interface PantryItem {
  id: string;
  name: string;
  foodTypeId: string | null;
  emoji: string;
  locationId: LocationId;
  quantity: number;
  /** Quantity when added, for "x% left" displays. */
  initialQuantity: number;
  unit: Unit;
  /** Price paid in AUD for the whole initial quantity, if known. */
  price?: number;
  addedAt: string; // ISO date-time
  /** Printed date typed by the user (ISO date). Wins over estimates. */
  printedDate?: string;
  dateKind: DateKind;
  openedAt?: string; // ISO date-time
  frozenAt?: string;
  thawedAt?: string;
  /** Where the item came from. */
  source: "receipt" | "list" | "barcode" | "manual" | "order";
  barcode?: string;
  notes?: string;
}

export type ItemEventType = "added" | "opened" | "moved" | "used" | "binned" | "edited" | "cooked";

export interface ItemEvent {
  id: string;
  itemId: string;
  itemName: string;
  foodTypeId: string | null;
  type: ItemEventType;
  at: string;
  /** Quantity affected (used/binned) in the item's unit. */
  quantity?: number;
  unit?: Unit;
  /** AUD value of the quantity affected, when price is known. */
  value?: number;
  detail?: string;
}

/** Household-level overrides of the shelf-life table, learned from edits. */
export interface ShelfLifeOverride {
  foodTypeId: string;
  pantryDays?: number | null;
  fridgeDays?: number | null;
  freezerDays?: number | null;
  openedDays?: number | null;
}

export type Diet = "vegetarian" | "vegan" | "pescatarian" | "gluten-free" | "dairy-free" | "low-carb" | "halal" | "kosher";

export interface HouseholdProfile {
  householdName: string;
  people: number;
  diets: Diet[];
  allergies: string[];
  likes: string[];
  dislikes: string[];
}

export interface RecipeIngredient {
  name: string;
  quantity?: number;
  unit?: string;
  /** Matched food type, for pantry deduction and shopping list. */
  foodTypeId?: string | null;
  optional?: boolean;
}

export interface Recipe {
  id: string;
  title: string;
  source: "ai" | "database" | "saved" | "builtin";
  sourceUrl?: string;
  image?: string;
  servings: number;
  minutes?: number;
  ingredients: RecipeIngredient[];
  steps: string[];
  tags: string[];
  summary?: string;
  savedAt?: string;
}

export interface ShoppingListItem {
  id: string;
  name: string;
  foodTypeId: string | null;
  aisle: Aisle;
  quantity?: number;
  unit?: string;
  checked: boolean;
  addedAt: string;
  /** Why it is on the list. */
  reason?: "manual" | "recipe" | "staple" | "plan";
  recipeId?: string;
}

export interface MealPlanEntry {
  id: string;
  date: string; // ISO date
  recipeId: string;
  servings?: number;
}

export interface Settings {
  theme: "system" | "light" | "dark";
  digest: "off" | "daily" | "weekly";
  digestHour: number; // 0-23, local time
  pushEnabled: boolean;
  /** Days before the date when an item becomes "use soon". */
  useSoonDays: number;
  mealPlannerEnabled: boolean;
  onboarded: boolean;
}

/** A line read from a receipt, list, order or barcode, awaiting review. */
export interface DraftItem {
  key: string;
  rawText?: string;
  name: string;
  foodTypeId: string | null;
  emoji: string;
  locationId: LocationId;
  quantity: number;
  unit: Unit;
  price?: number;
  printedDate?: string;
  dateKind: DateKind;
  include: boolean;
  confidence?: "high" | "medium" | "low";
}
