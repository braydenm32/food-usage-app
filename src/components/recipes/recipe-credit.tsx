import { ExternalLink } from "lucide-react";
import type { Recipe } from "@/lib/types";

const linkClass = "inline-flex items-center gap-1 underline underline-offset-2 hover:text-ink";

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={linkClass}>
      {children}
    </a>
  );
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Where a recipe comes from, and the credit its licence asks for. Shown under the method. */
export function RecipeCreditLine({ recipe }: { recipe: Recipe }) {
  const { credit, sourceUrl } = recipe;

  let body: React.ReactNode = null;
  if (credit?.licence) {
    // Openly licensed text (Wikibooks): title, source, authors, licence and changes, as CC asks.
    body = (
      <>
        From &ldquo;{recipe.title}&rdquo; on {credit.url ? <ExtLink href={credit.url}>{credit.name}</ExtLink> : credit.name}
        {credit.authorsUrl && (
          <>
            {" "}by <ExtLink href={credit.authorsUrl}>its contributors</ExtLink>
          </>
        )}
        , {credit.licenceUrl ? <ExtLink href={credit.licenceUrl}>{credit.licence}</ExtLink> : credit.licence}.
        {credit.changes ? ` ${credit.changes}.` : ""}
      </>
    );
  } else if (credit) {
    body = (
      <>
        Recipe{recipe.image ? " and photo" : ""} from {credit.url ? <ExtLink href={credit.url}>{credit.name}</ExtLink> : credit.name}.
        {sourceUrl && sourceUrl !== credit.url && (
          <>
            {" "}
            <ExtLink href={sourceUrl}>
              Original recipe <ExternalLink size={12} aria-hidden />
            </ExtLink>
          </>
        )}
      </>
    );
  } else if (recipe.source === "ai") {
    body = <>A Larder original, written by AI around what&apos;s in your larder. Check it suits you before you cook.</>;
  } else if (sourceUrl) {
    // Imported from a website: a personal copy for this household, with the way back to the author.
    const host = hostOf(sourceUrl);
    body = (
      <>
        Saved{host ? ` from ${host}` : ""} for your household&apos;s own use.{" "}
        <ExtLink href={sourceUrl}>
          Original recipe <ExternalLink size={12} aria-hidden />
        </ExtLink>
      </>
    );
  }
  if (!body) return null;
  return <p className="mt-6 text-sm leading-relaxed text-ink-3">{body}</p>;
}
