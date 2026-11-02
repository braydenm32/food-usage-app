-- Household staples ("Always keep in stock") sync like the other shared collections.
-- Barcode memory stays on each device and is never stored here.

alter table public.household_records drop constraint if exists household_records_collection_check;
alter table public.household_records add constraint household_records_collection_check check (collection in (
  'items', 'events', 'locations', 'overrides', 'profile', 'savedRecipes', 'shoppingList', 'mealPlan', 'staples'
));
