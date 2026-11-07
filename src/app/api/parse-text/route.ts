import { getAnthropic } from "@/lib/ai";
import { lineToDraft, matchRate, parseLocalList, type ApiError, type ParseResponse } from "@/lib/drafts";
import { ExtractError, extractWithClaude, extractionToDrafts } from "@/lib/extract-lines";
import { BodyTooLargeError, readCappedJson } from "@/lib/http-body";
import { authenticateAi, bearerToken, consumeAiCall } from "@/lib/server-auth";

/** Room for the AI's timeout and one quick retry. */
export const maxDuration = 60;

const MAX_CHARS = 30_000;
/** 30,000 characters can take up to 3 bytes each in UTF-8, plus the JSON around them. */
const MAX_BODY_BYTES = 128 * 1024;

function error(status: number, code: string, message: string) {
  return Response.json({ error: code, message } satisfies ApiError, { status });
}

/**
 * POST JSON `{ text: string, ai?: boolean }`: a typed list or a pasted order confirmation email.
 * The local parser always runs first. Claude is used only when a key is configured and the text
 * looks like an order email or the local parse matched poorly (or `ai: true` asks for it).
 * Without a key the local parse is returned, so this route always works offline-from-AI.
 * The AI step needs a signed-in user (`Authorization: Bearer <Supabase access token>`) and counts
 * against their daily allowance; signed out, the local parse comes back with a note.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await readCappedJson(request, MAX_BODY_BYTES);
  } catch (e) {
    if (e instanceof BodyTooLargeError) {
      return error(413, "too_long", "That's a lot of text. Paste just the items part of the email.");
    }
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

  // Smart reading is for signed-in people; everyone else still gets the line-by-line read.
  const user = bearerToken(request) ? await authenticateAi(request) : null;
  const denied = !user ? null : !user.ok ? user.response : await consumeAiCall(user);
  if (!user || !user.ok || denied) {
    const status = denied?.status ?? 401;
    if (localDrafts.length) {
      return Response.json({
        ...localResult,
        note:
          status === 429
            ? "You've reached today's AI limit, so these were read line by line. Check them over."
            : status === 401
              ? "These were read line by line. Sign in and Larder can read lists and order emails more smartly."
              : "Smart reading wasn't available, so these were read line by line. Check them over.",
      } satisfies ParseResponse);
    }
    if (denied && status !== 401) return denied;
    return error(
      401,
      "sign_in_required",
      "Couldn't find any items line by line. Sign in so Larder can read it more smartly, or try one item per line.",
    );
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
