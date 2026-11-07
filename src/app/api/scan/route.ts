import { connection } from "next/server";
import { AI_NOT_CONFIGURED, getAnthropic } from "@/lib/ai";
import type { ApiError, ParseResponse } from "@/lib/drafts";
import { ExtractError, extractWithClaude, extractionToDrafts } from "@/lib/extract-lines";
import { BodyTooLargeError, FORM_OVERHEAD_BYTES, MAX_IMAGE_BYTES, readCappedForm, sniffImageType } from "@/lib/http-body";
import { aiAuthConfigured, authenticateAi, consumeAiCall } from "@/lib/server-auth";

/** Photo reading can take a while; leave room for the AI's timeout and one quick retry. */
export const maxDuration = 60;

const TOO_BIG = "That photo is too big. Try a smaller photo (under 4 MB).";

function error(status: number, code: string, message: string) {
  return Response.json({ error: code, message } satisfies ApiError, { status });
}

/**
 * GET: whether photo reading is available, so the UI can say so before the user takes a photo.
 * `signIn: "required"` says it only works for signed-in people.
 */
export async function GET() {
  await connection(); // read the env at request time, not at build
  return Response.json({ configured: !!getAnthropic() && aiAuthConfigured(), signIn: "required" });
}

/**
 * POST multipart/form-data: `image` (File, JPEG/PNG/WebP/GIF, max 4 MB) and `kind` ("receipt" | "list" | "shelf"),
 * with `Authorization: Bearer <Supabase access token>`. Reads the photo with Claude and returns draft items for review.
 */
export async function POST(request: Request) {
  if (!getAnthropic()) return Response.json(AI_NOT_CONFIGURED, { status: 503 });
  const user = await authenticateAi(request);
  if (!user.ok) return user.response;

  let form: FormData;
  try {
    form = await readCappedForm(request, MAX_IMAGE_BYTES + FORM_OVERHEAD_BYTES);
  } catch (e) {
    if (e instanceof BodyTooLargeError) return error(413, "image_too_large", TOO_BIG);
    return error(400, "bad_request", "Send the photo as form data with an 'image' field.");
  }

  const rawKind = form.get("kind");
  const kind = rawKind === "list" ? "list" : rawKind === "shelf" ? "shelf" : "receipt";
  const file = form.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return error(400, "no_image", "No photo was received. Choose a photo and try again.");
  }
  if (file.size > MAX_IMAGE_BYTES) return error(413, "image_too_large", TOO_BIG);

  const bytes = new Uint8Array(await file.arrayBuffer());
  // Trust the file's own bytes, not the type the browser (or anyone) claimed.
  const mediaType = sniffImageType(bytes);
  if (!mediaType) {
    return error(415, "unsupported_image", "That file type isn't supported. Use a JPEG, PNG or WebP photo.");
  }

  const denied = await consumeAiCall(user);
  if (denied) return denied;

  try {
    const extraction = await extractWithClaude({
      kind,
      image: { data: Buffer.from(bytes).toString("base64"), mediaType },
    });
    const drafts = extractionToDrafts(extraction);
    if (!extraction.readable || drafts.length === 0) {
      return error(
        422,
        "unreadable",
        kind === "receipt"
          ? "Couldn't find any items on that receipt. Try a flatter, well-lit photo of the whole receipt."
          : kind === "shelf"
            ? "Couldn't spot any food in that photo. Try a closer, well-lit shot of one shelf."
          : "Couldn't read any items on that list. Try a closer, well-lit photo.",
      );
    }
    return Response.json({
      drafts,
      method: "ai",
      storeName: extraction.storeName,
      date: extraction.date,
    } satisfies ParseResponse);
  } catch (err) {
    if (err instanceof ExtractError) return error(err.status, err.code, err.message);
    throw err;
  }
}
