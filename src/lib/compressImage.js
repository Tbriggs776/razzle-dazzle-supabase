/**
 * Shrink a camera photo before uploading it.
 *
 * A modern phone camera produces 3–12MB per shot, and a job-start checklist wants
 * five sets of them. On a job site that is minutes of upload on a bad connection,
 * and the most common way a checklist fails is simply that the crew gives up
 * waiting. ~1600px on the long edge at 0.82 quality lands around 200–400KB and is
 * still far more detail than anyone needs to see that a floor was covered or a
 * wall was scuffed.
 *
 * Everything about this is best-effort: if anything at all goes wrong — an
 * unsupported type, a canvas the browser refuses to allocate, a HEIC the decoder
 * will not touch — it returns the ORIGINAL file. A photo that uploads slowly is a
 * nuisance; a photo that cannot upload is missing evidence.
 */

const MAX_EDGE = 1600;
const QUALITY = 0.82;
// Below this it is not worth the decode; a small file is already fine.
const SKIP_BELOW_BYTES = 600 * 1024;

export async function compressImage(file) {
  try {
    if (!file || !file.type?.startsWith('image/')) return file;
    if (file.type === 'image/gif') return file;          // would lose animation
    if (file.size <= SKIP_BELOW_BYTES) return file;

    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1) { bitmap.close?.(); return file; }

    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) { bitmap.close?.(); return file; }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', QUALITY));
    if (!blob || blob.size >= file.size) return file;   // never make it worse

    const name = (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file;
  }
}
