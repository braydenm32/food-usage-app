import { ExternalLink } from "lucide-react";
import { SectionTitle } from "@/components/ui";

/**
 * Popular recipe sites, as plain search links. Their terms don't allow other apps to copy their
 * recipes or photos, so Larder only sends people there; nothing is fetched or stored.
 */
export const RECIPE_SITES: { name: string; home: string; search: (q: string) => string }[] = [
  { name: "taste.com.au", home: "https://www.taste.com.au/", search: (q) => `https://www.taste.com.au/search-recipes/?q=${q}` },
  { name: "RecipeTin Eats", home: "https://www.recipetineats.com/", search: (q) => `https://www.recipetineats.com/?s=${q}` },
  { name: "BBC Good Food", home: "https://www.bbcgoodfood.com/", search: (q) => `https://www.bbcgoodfood.com/search?q=${q}` },
  { name: "Allrecipes", home: "https://www.allrecipes.com/", search: (q) => `https://www.allrecipes.com/search?q=${q}` },
];

export function MoreIdeasLinks({ term }: { term: string | null }) {
  const q = term ? encodeURIComponent(term.toLowerCase()) : null;
  return (
    <>
      <SectionTitle>More ideas from recipe sites</SectionTitle>
      <p className="-mt-1 mb-3 text-sm text-ink-2">
        {term ? `Search for ${term.toLowerCase()} on these sites.` : "Browse these sites for more ideas."} They open in your browser. If you find one you like, use
        Import to save it to your recipes.
      </p>
      <ul className="flex flex-wrap gap-2">
        {RECIPE_SITES.map((s) => (
          <li key={s.name}>
            <a
              href={q ? s.search(q) : s.home}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center gap-1.5 rounded-full border border-line bg-surface px-4 text-sm font-semibold text-ink hover:bg-surface-2"
            >
              {s.name} <ExternalLink size={14} aria-hidden />
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}
