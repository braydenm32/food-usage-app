"use client";

import { Suspense } from "react";
import { PageHeader } from "@/components/ui";
import { RecipesView } from "@/components/recipes/recipes-view";

/** The plan lives in Recipes now ("This week"); this address still opens it. */
export default function PlanPage() {
  return (
    <Suspense fallback={<PageHeader title="Recipes" />}>
      <RecipesView defaultTab="week" />
    </Suspense>
  );
}
