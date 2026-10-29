import { connection } from "next/server";
import { AI_NOT_CONFIGURED, getAnthropic } from "@/lib/ai";
import type { ApiError, ParseResponse } from "@/lib/drafts";
import { ExtractError, extractWithClaude, extractionToDrafts } from "@/lib/extract-lines";

const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function error(status: number, code: string, message: string) {
  return Response.json({ error: code, message } satisfies ApiError, { status });
}

/** GET: whether photo reading is available, so the UI can say so before the user takes a photo. */
export async function GET() {
  await connection(); // read the env at request time, not at build
  return Response.json({ configured: !!getAnthropic() });
}

/**
 * POST multipart/form-data: `image` (File, JPEG/PNG/WebP/GIF, max 8 MB) and `kind` ("receipt" | "list").
 * Reads the photo with Claude and returns draft items for review.
 */
export async function POST(request: Request) {
  if (!getAnthropic()) return Response.json(AI_NOT_CONFIGURED, { status: 503 });

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES + 64 * 1024) {
    return error(413, "image_too_large", "That photo is too big. Try a smaller photo (under 8 MB).");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return error(400, "bad_request", "Send the photo as form data with an 'image' field.");
  }

  const kind = form.get("kind") === "list" ? "list" : "receipt";
  const file = form.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return error(400, "no_image", "No photo was received. Choose a photo and try again.");
  }
  if (file.size > MAX_BYTES) {
    return error(413, "image_too_large", "That photo is too big. Try a smaller photo (under 8 MB).");
  }
  if (!ACCEPTED.has(file.type)) {
    return error(415, "unsupported_image", "That file type isn't supported. Use a JPEG, PNG or WebP photo.");
  }

  const data = Buffer.from(await file.arrayBuffer()).toString("base64");

  try {
    const extraction = await extractWithClaude({
      kind,
      image: { data, mediaType: file.type as "image/jpeg" | "image/png" | "image/webp" | "image/gif" },
    });
    const drafts = extractionToDrafts(extraction);
    if (!extraction.readable || drafts.length === 0) {
      return error(
        422,
        "unreadable",
        kind === "receipt"
          ? "Couldn't find any items on that receipt. Try a flatter, well-lit photo of the whole receipt."
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
