/**
 * Preparing a receipt photo in the browser before sending it.
 *
 * Phone photos are 3–12 MB, but the AI downsizes to ~1300×1300 anyway. So
 * we shrink to at most MAX_SIDE pixels and re-encode as JPEG (~300 KB):
 * 10–40× faster to upload with no loss in reading quality. Re-encoding
 * also converts WebP/PNG and drops metadata such as GPS location.
 */

export const MAX_SIDE = 1600; // px; a bit above what the AI uses
export const MAX_FILE_BYTES = 25 * 1024 * 1024; // the original photo

/** A message if this file can't be a usable photo, else null. */
export function imageFileProblem(file) {
  if (!file) return "Choose a photo of a receipt";
  const isImage =
    (file.type ?? "").startsWith("image/") ||
    /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name ?? "");
  if (!isImage) {
    return "That isn't a photo. Choose a JPEG, PNG or similar image of the receipt";
  }
  if (file.size > MAX_FILE_BYTES) return "That photo is too large (over 25 MB)";
  return null;
}

/** New size that fits within max×max, keeping the shape and never enlarging. */
export function fitWithin(width, height, max = MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Decode, shrink and re-encode a photo as a JPEG data URL.
 * createImageBitmap applies the photo's EXIF rotation, so a sideways
 * phone photo arrives upright. Throws an Error with a friendly message
 * if the browser can't read the photo (e.g. HEIC in some browsers).
 */
export async function shrinkImage(
  file,
  { max = MAX_SIDE, quality = 0.82 } = {},
) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (err) {
    // NotReadableError: the file itself couldn't be read (moved, deleted,
    // or no permission), which is a different problem from the format.
    throw new Error(
      err?.name === "NotReadableError"
        ? "Couldn't open that file; try choosing it again"
        : "This browser can't read that photo format. Try a JPEG or PNG (on iPhone: Settings → Camera → Formats → Most Compatible)",
    );
  }
  const { width, height } = fitWithin(bitmap.width, bitmap.height, max);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff"; // transparent PNGs become white, not black
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", quality);
}
