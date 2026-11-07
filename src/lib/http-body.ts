/**
 * Request bodies read with a hard byte cap. Content-Length alone can't be trusted (a chunked
 * upload doesn't send one), so the stream is read here and dropped the moment it passes the cap.
 */

/** Photos are shrunk in the browser to well under this; it also fits Vercel's 4.5 MB body limit. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
/** Room for the multipart boundary and the other small form fields around a photo. */
export const FORM_OVERHEAD_BYTES = 64 * 1024;

export class BodyTooLargeError extends Error {
  constructor(public limit: number) {
    super(`Body is over ${limit} bytes`);
  }
}

/** The whole body as bytes, or BodyTooLargeError once more than `limit` bytes arrive. */
export async function readCapped(req: Request, limit: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > limit) throw new BodyTooLargeError(limit);
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLargeError(limit);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** The body as text (UTF-8), capped. */
export async function readCappedText(req: Request, limit: number): Promise<string> {
  return new TextDecoder().decode(await readCapped(req, limit));
}

/** The body parsed as JSON, capped. Throws SyntaxError for bad JSON. */
export async function readCappedJson(req: Request, limit: number): Promise<unknown> {
  return JSON.parse(await readCappedText(req, limit));
}

/** The body parsed as form data (multipart or urlencoded), capped. */
export async function readCappedForm(req: Request, limit: number): Promise<FormData> {
  const bytes = await readCapped(req, limit);
  const type = req.headers.get("content-type") ?? "";
  return new Response(bytes as BodyInit, { headers: { "content-type": type } }).formData();
}

export type ImageType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

/** The image type from the file's first bytes (not what the browser claimed), or null. */
export function sniffImageType(b: Uint8Array): ImageType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return "image/png";
  }
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (b.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) return "image/gif";
  return null;
}
