import { cx } from "@/components/ui";
import { recipeImage, recipePlaceholder } from "@/lib/recipes/display";
import type { Recipe } from "@/lib/types";

/**
 * A recipe's picture: the library photo when there is one, otherwise a designed placeholder
 * (a soft tint with the main ingredient's emoji, or the title's initial in Young Serif).
 */
export function RecipeThumb({ recipe, variant = "card", className }: { recipe: Recipe; variant?: "card" | "feature" | "hero"; className?: string }) {
  const src = recipeImage(recipe);
  const shape =
    variant === "card"
      ? "h-20 w-20 shrink-0 rounded-2xl"
      : variant === "feature"
        ? "aspect-[16/9] w-full rounded-2xl lg:aspect-auto lg:h-full lg:min-h-44 lg:w-56 lg:shrink-0"
        : "aspect-[16/9] w-full rounded-3xl lg:max-h-72";
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" loading={variant === "hero" ? "eager" : "lazy"} className={cx(shape, "bg-surface-2 object-cover", className)} />;
  }
  const p = recipePlaceholder(recipe);
  const big = variant !== "card";
  return (
    <div aria-hidden className={cx(shape, p.tint, "flex items-center justify-center overflow-hidden", className)}>
      {p.emoji ? (
        <span className={cx("leading-none", big ? "text-6xl lg:text-7xl" : "text-4xl")}>{p.emoji}</span>
      ) : (
        <span className={cx("font-display leading-none text-ink/70", big ? "text-7xl" : "text-4xl")}>{p.initial}</span>
      )}
    </div>
  );
}
