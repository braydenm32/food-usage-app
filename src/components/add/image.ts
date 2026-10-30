"use client";

const MAX_SIDE = 1600;
const QUALITY = 0.8;

async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // fall through to <img>, which some browsers decode more formats with (e.g. HEIC on Safari)
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // Safe to revoke once decoded.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/**
 * Shrink a photo to at most 1600px on the long side and re-encode as JPEG (~0.8),
 * so uploads stay small on mobile data. Throws if the browser can't decode the file.
 */
export async function downscaleImage(file: File): Promise<Blob> {
  const src = await loadBitmap(file);
  const w = "naturalWidth" in src ? src.naturalWidth : src.width;
  const h = "naturalHeight" in src ? src.naturalHeight : src.height;
  if (!w || !h) throw new Error("Image has no size");
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const cw = Math.round(w * scale);
  const ch = Math.round(h * scale);

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.fillStyle = "#fff"; // transparent PNGs become white, not black, in JPEG
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(src, 0, 0, cw, ch);
  if ("close" in src) src.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
  if (!blob) throw new Error("Couldn't encode image");
  return blob;
}
