import { getAnthropic } from "@/lib/ai";
import { lineToDraft, matchRate, parseLocalList, type ApiError, type ParseResponse } from "@/lib/drafts";
import { ExtractError, extractWithClaude, extractionToDrafts } from "@/lib/extract-lines";

const MAX_CHARS = 30_000;

function error(status: number, code: string, message: string) {
  return Response.json({ error: code, message } satisfies ApiError, { status });
}

/**
 * POST JSON `{ text: string, ai?: boolean }`: a typed list or a pasted order confirmation email.
 * The local parser always runs first. Claude is used only when a key is configured and the text
 * looks like an order email or the local parse matched poorly (or `ai: true` asks for it).
 * Without a key the local parse is returned, so this route always works offline-from-AI.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error(400, "bad_request", "Send JSON like { \"text\": \"milk\\neggs\" }.");
  }
  const text = typeof (body as { text?: unknown })?.text === "string" ? (body as { text: string }).text : "";
  const forceAi = (body as { ai?: unknown })?.ai === true;

  if (!text.trim()) return error(400, "empty", "Paste or type at least one item.");
  if (text.length > MAX_CHARS) {
    return error(413, "too_long", "That's a lot of text. Paste just the items part of the email.");
  }

  const local = parseLocalList(text);
  const localDrafts = local.lines.map(lineToDraft);
  const rate = matchRate(localDrafts);
  const localResult: ParseResponse = { drafts: localDrafts, method: "local", orderEmail: local.orderEmail };

  const poor = localDrafts.length === 0 || (localDrafts.length >= 3 && rate < 0.5);
  const wantAi = forceAi || local.orderEmail || poor;
  if (!wantAi) return Response.json(localResult);

  if (!getAnthropic()) {
    if (localDrafts.length === 0) {
      return error(422, "nothing_found", "Couldn't find any items in that text. Try one item per line.");
    }
    return Response.json(localResult);
  }

  try {
    const extraction = await extractWithClaude({ kind: local.orderEmail ? "order" : "list", text });
    const drafts = extractionToDrafts(extraction);
    if (drafts.length === 0) {
      if (localDrafts.length) return Response.json(localResult);
      return error(422, "nothing_found", "Couldn't find any items in that text. Try one item per line.");
    }
    return Response.json({
      drafts,
      method: "ai",
      storeName: extraction.storeName,
      date: extraction.date,
      orderEmail: local.orderEmail,
    } satisfies ParseResponse);
  } catch (err) {
    // AI trouble shouldn't block the user: fall back to what the local parser found.
    if (localDrafts.length) {
      return Response.json({
        ...localResult,
        note: "Smart reading wasn't available, so these were read line by line. Check them over.",
      } satisfies ParseResponse);
    }
    if (err instanceof ExtractError) return error(err.status, err.code, err.message);
    throw err;
  }
}
