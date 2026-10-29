import { cacheLife } from "next/cache";
import { offProductToResponse, type ApiError, type BarcodeResponse, type OffProduct } from "@/lib/drafts";

const USER_AGENT = "Larder/0.1 (food tracker)";
const FIELDS = "product_name,brands,quantity,categories_tags,image_front_small_url";

type Lookup = { status: "found"; product: OffProduct } | { status: "missing" };

/** Cached for a day per barcode. Network failures throw, so they are not cached. */
async function lookupOpenFoodFacts(code: string): Promise<Lookup> {
  "use cache";
  cacheLife("days");

  const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${FIELDS}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 404) return { status: "missing" };
  if (!res.ok) throw new Error(`Open Food Facts responded ${res.status}`);
  const json = (await res.json()) as { status?: number; product?: OffProduct };
  if (json.status !== 1 || !json.product) return { status: "missing" };
  return { status: "found", product: json.product };
}

export async function GET(_request: Request, ctx: RouteContext<"/api/barcode/[code]">) {
  const { code: rawCode } = await ctx.params;
  const code = decodeURIComponent(rawCode).replace(/\s+/g, "");
  if (!/^\d{6,14}$/.test(code)) {
    return Response.json(
      { error: "bad_code", message: "Barcodes are 6 to 14 digits. Check the number and try again." } satisfies ApiError,
      { status: 400 },
    );
  }

  let lookup: Lookup;
  try {
    lookup = await lookupOpenFoodFacts(code);
  } catch (err) {
    console.error("[barcode] lookup failed", err);
    return Response.json(
      {
        error: "lookup_failed",
        message: "Couldn't reach the product database. Check your connection, or add it by hand.",
      } satisfies ApiError,
      { status: 502 },
    );
  }

  if (lookup.status === "missing" || !lookup.product.product_name?.trim()) {
    return Response.json({ found: false, code } satisfies BarcodeResponse, { status: 404 });
  }

  return Response.json(offProductToResponse(code, lookup.product));
}
