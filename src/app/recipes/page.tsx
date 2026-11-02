"use client";

import { Suspense } from "react";
import { PageHeader } from "@/components/ui";
import { RecipesView } from "@/components/recipes/recipes-view";

export default function RecipesPage() {
  return (
    <Suspense fallback={<PageHeader title="Recipes" />}>
      <RecipesView />
    </Suspense>
  );
}
