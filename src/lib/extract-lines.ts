import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { AI_MODEL, getAnthropic } from "@/lib/ai";
import { lineToDraft, normaliseUnit, type ParsedLine, type ReviewDraft } from "@/lib/drafts";

/* Structured output from Claude: one entry per line on the receipt / list / email. */
const UNIT_VALUES = ["item", "g", "kg", "ml", "L", "pack", "bunch", "dozen", "loaf", "tin", "jar", "bottle"] as const;

const ExtractedLine = z.object({
  rawText: z.string().describe("The line exactly as printed or written, e.g. 'WW RSPBRY 125G'"),
  name: z
    .string()
    .describe("Plain everyday name of the food in Australian English, lower case, no brand or size, e.g. 'raspberries'"),
  count: z.number().nullable().describe("How many packs or items were bought (the 2 in '2 x milk 2L'); null if not shown"),
  size: z.number().nullable().describe("Pack size or loose amount (the 2 in '2 x milk 2L'); null if not shown"),
  unit: z.enum(UNIT_VALUES).nullable().describe("Unit for size; null if no size"),
  price: z.number().nullable().describe("Line total in AUD after any line discount; null if not shown"),
  printedDate: z.string().nullable().describe("A use-by or best-before date printed for this item as YYYY-MM-DD; usually null"),
  isFood: z.boolean().describe("False for bags, cleaning, toiletries, pet, household goods, discounts, fees, totals, payment lines"),
});

const Extraction = z.object({
  storeName: z.string().nullable().describe("Shop name if visible, e.g. 'Woolworths'"),
  date: z.string().nullable().describe("Purchase or delivery date as YYYY-MM-DD if visible"),
  readable: z.boolean().describe("False if the image or text has no readable shopping lines"),
  lines: z.array(ExtractedLine),
});

export type Extraction = z.infer<typeof Extraction>;
export type ExtractKind = "receipt" | "list" | "order";

const SYSTEM = `You read Australian grocery receipts, shopping lists and supermarket order emails for a household food tracker.
Return every purchased line in order. Expand receipt abbreviations into the everyday food name in Australian English
(for example "WW RSPBRY 125G" is raspberries 125 g, "CC BBY SPNCH 120G" is baby spinach, "MCH CHKN BRST FLLT" is chicken breast fillets;
use capsicum, zucchini, rockmelon, coriander, prawns). Drop brand names and sizes from name; keep them in rawText.
For weighed produce like "BANANAS 0.845kg @ $3.90/kg" give size 0.845, unit kg, price as the line total.
When a quantity line follows a product (e.g. "2 @ $1.50"), fold it into that product.
Mark discounts, savings, subtotals, GST, payment, change, rewards points, bags and non-food items with isFood false and keep them in the list.
For an email, skip greetings, addresses, delivery windows and marketing; skip items marked unavailable or refunded, and use the substitute when one is given.
Never invent lines you cannot read. If nothing is readable, return readable false with no lines.`;

export class ExtractError extends Error {
  constructor(
    public code: "ai_failed" | "unreadable" | "ai_refused" | "rate_limited",
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

type ImageMedia = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

export async function extractWithClaude(
  input: { kind: ExtractKind; image?: { data: string; mediaType: ImageMedia }; text?: string },
): Promise<Extraction> {
  const client = getAnthropic();
  if (!client) throw new Error("AI not configured");

  const what =
    input.kind === "receipt"
      ? "this supermarket receipt"
      : input.kind === "list"
        ? "this shopping list (it may be handwritten; every line is something bought or to buy, so isFood is true unless it is clearly not food)"
        : "this supermarket order confirmation email";

  const content: Anthropic.ContentBlockParam[] = [];
  if (input.image) {
    content.push({ type: "image", source: { type: "base64", media_type: input.image.mediaType, data: input.image.data } });
    content.push({ type: "text", text: `Read ${what}.` });
  } else {
    content.push({ type: "text", text: `Read ${what}.\n\n<document>\n${input.text ?? ""}\n</document>` });
  }

  try {
    const response = await client.messages.parse({
      model: AI_MODEL,
      // Enough for a long order (~100 lines) without letting one request run up a big bill.
      max_tokens: 4000,
      system: SYSTEM,
      messages: [{ role: "user", content }],
      output_config: { effort: "low", format: zodOutputFormat(Extraction) },
    });
    if (response.stop_reason === "refusal") {
      throw new ExtractError("ai_refused", "Couldn't read that one. Try a clearer photo or paste the list instead.");
    }
    if (!response.parsed_output) {
      throw new ExtractError("ai_failed", "Couldn't make sense of that. Try again, or paste the list instead.");
    }
    return response.parsed_output;
  } catch (err) {
    if (err instanceof ExtractError) throw err;
    if (err instanceof Anthropic.RateLimitError) {
      throw new ExtractError("rate_limited", "Reading is busy right now. Wait a moment and try again.", 429);
    }
    if (err instanceof Anthropic.APIError) {
      console.error("[extract] Anthropic API error", err.status, err.message);
      throw new ExtractError("ai_failed", "Couldn't reach the reading service. Try again, or paste the list instead.");
    }
    console.error("[extract] failed", err);
    throw new ExtractError("ai_failed", "Something went wrong reading that. Try again, or paste the list instead.");
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function extractionToDrafts(x: Extraction): ReviewDraft[] {
  return x.lines.map((l) => {
    const unit = l.unit ? normaliseUnit(l.unit) ?? l.unit : undefined;
    const line: ParsedLine = {
      rawText: l.rawText || undefined,
      name: l.name || l.rawText,
      count: l.count ?? undefined,
      size: l.size && unit ? { quantity: l.size, unit } : undefined,
      price: l.price ?? undefined,
      printedDate: l.printedDate && ISO_DATE.test(l.printedDate) ? l.printedDate : undefined,
      isFood: l.isFood,
    };
    return lineToDraft(line);
  });
}
