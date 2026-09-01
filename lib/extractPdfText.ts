'use client';

// ── PDF ────────────────────────────────────────────────────────────────────
export async function extractPdfText(
  file: File,
  onProgress?: (page: number, total: number) => void
): Promise<{ text: string; pageCount: number }> {
  const pdfjs = await import('pdfjs-dist');

  // Use unpkg to serve the matching worker — avoids local worker bundling complexity
  pdfjs.GlobalWorkerOptions.workerSrc =
    `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const pageCount: number = pdf.numPages;
  const parts: string[] = [];

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pageText = content.items.map((item: any) => ('str' in item ? item.str : '')).join(' ').trim();
    if (pageText) parts.push(pageText);
    onProgress?.(i, pageCount);
  }

  return { text: parts.join('\n\n'), pageCount };
}

// ── PPTX ───────────────────────────────────────────────────────────────────
export async function extractPptxText(file: File): Promise<{ text: string; pageCount: number }> {
  const JSZip = (await import('jszip')).default;
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  const slideFiles = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const n = (s: string) => parseInt(s.match(/\d+/)?.[0] ?? '0', 10);
      return n(a) - n(b);
    });

  const parts: string[] = [];
  for (const path of slideFiles) {
    const xml = await zip.files[path].async('text');
    const texts = xml.match(/<a:t[^>]*>([^<]+)<\/a:t>/g) ?? [];
    const slideText = texts.map(t => t.replace(/<[^>]+>/g, '')).join(' ').trim();
    if (slideText) parts.push(slideText);
  }

  return { text: parts.join('\n\n'), pageCount: slideFiles.length };
}

// ── DOCX ───────────────────────────────────────────────────────────────────
export async function extractDocxText(file: File): Promise<{ text: string; pageCount: number }> {
  const JSZip = (await import('jszip')).default;
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  const docXml = await zip.files['word/document.xml']?.async('text');
  if (!docXml) return { text: '', pageCount: 1 };

  const texts = docXml.match(/<w:t[^>]*>[^<]*<\/w:t>/g) ?? [];
  const text = texts.map(t => t.replace(/<[^>]+>/g, '')).join(' ').replace(/\s+/g, ' ').trim();
  const estimatedPages = Math.max(1, Math.ceil(text.length / 3000));

  return { text, pageCount: estimatedPages };
}

// ── Unified extractor ──────────────────────────────────────────────────────
export async function extractFileText(
  file: File,
  onProgress?: (page: number, total: number) => void
): Promise<{ text: string; pageCount: number }> {
  const name = file.name.toLowerCase();
  const type = file.type;

  const isPdf  = type === 'application/pdf'        || name.endsWith('.pdf');
  const isPptx = type.includes('presentationml')   || name.endsWith('.pptx');
  const isDocx = type.includes('wordprocessingml') || name.endsWith('.docx');

  if (isPdf)  return extractPdfText(file, onProgress);
  if (isPptx) return extractPptxText(file);
  if (isDocx) return extractDocxText(file);

  throw new Error('Unsupported file type. Use PDF, PPTX, or DOCX.');
}

// ── Image-only slide fallback ───────────────────────────────────────────────
// A slide whose content was flattened into a picture (a lecturer's exported
// image, or a scanned page pasted in) has no <a:t>/<w:t> text to find — the
// functions above correctly return almost nothing for it, because there is
// nothing there, not because extraction failed. The caller detects that (low
// average characters per page/slide) and calls these to recover the content
// visually instead. Everything here runs in the browser: images are pulled
// straight out of the pptx/docx zip (or rendered from the PDF's own pages,
// using the browser's real <canvas> — this project deliberately has no
// server-side canvas), downscaled, and sent to the server in small batches
// so no single request comes anywhere near a serverless platform's request
// body limit, no matter how large the original file is.

export interface ExtractedImage { blob: Blob; mime: string; name: string }

const IMAGE_EXT_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp',
};
const MIN_IMAGE_BYTES = 15_000; // skip small icons/logos/bullets
const MAX_IMAGES = 60;          // sanity ceiling, not a real-world cap

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function collectZipImages(zip: any, mediaPrefix: string): Promise<ExtractedImage[]> {
  const entries = Object.keys(zip.files).filter((n: string) => n.startsWith(mediaPrefix));
  const out: (ExtractedImage & { size: number })[] = [];

  for (const name of entries) {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    const mime = IMAGE_EXT_MIME[ext];
    if (!mime) continue;
    const arr = await zip.files[name].async('arraybuffer') as ArrayBuffer;
    if (arr.byteLength < MIN_IMAGE_BYTES) continue;
    out.push({ blob: new Blob([arr], { type: mime }), mime, name, size: arr.byteLength });
  }

  // Largest first — if a deck has more pictures than MAX_IMAGES can cover,
  // the full slide pictures (not small leftover decorative art) win.
  return out.sort((a, b) => b.size - a.size).slice(0, MAX_IMAGES);
}

export async function extractPptxImages(file: File): Promise<ExtractedImage[]> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  return collectZipImages(zip, 'ppt/media/');
}

export async function extractDocxImages(file: File): Promise<ExtractedImage[]> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  return collectZipImages(zip, 'word/media/');
}

// Renders each PDF page to an image using pdfjs's own canvas support — for
// a scanned/image-only PDF, there's no embedded-media folder to raid like a
// pptx/docx, but rendering the page itself gives vision the same picture a
// human would see.
export async function extractPdfPageImages(
  file: File,
  onProgress?: (page: number, total: number) => void
): Promise<ExtractedImage[]> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc =
    `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const pageCount = Math.min(pdf.numPages, 40); // sanity cap on a scanned deck
  const images: ExtractedImage[] = [];

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await page.render({ canvasContext: ctx as any, canvas, viewport } as any).promise;
      const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.75));
      if (blob) images.push({ blob, mime: 'image/jpeg', name: `page-${i}.jpg` });
    }
    onProgress?.(i, pageCount);
  }

  return images;
}

// Shrinks an image before upload — a slide photo/screenshot straight out of
// a pptx can be 2MB+; at 1600px/JPEG-0.72 it's typically under 300KB with no
// loss that matters for reading text off it, keeping every batch small.
async function downscaleImage(blob: Blob, maxDim = 1600, quality = 0.72): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale) || bitmap.width;
    const h = Math.round(bitmap.height * scale) || bitmap.height;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return blob;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const out: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    return out || blob;
  } catch {
    return blob; // fall back to the original — better than dropping the image
  }
}

const VISION_BATCH_SIZE = 6; // keeps each upload comfortably under serverless request-body limits

/** Sends extracted images to the server for AI vision OCR, a handful per
 * request so total upload size never depends on the original file's size,
 * and returns the merged transcribed text across all of them. */
export async function visionOcrImages(
  images: ExtractedImage[],
  onProgress?: (done: number, total: number) => void
): Promise<string> {
  const texts: string[] = [];
  let done = 0;

  for (let i = 0; i < images.length; i += VISION_BATCH_SIZE) {
    const batch = images.slice(i, i + VISION_BATCH_SIZE);
    const form = new FormData();
    for (const img of batch) {
      const small = await downscaleImage(img.blob);
      form.append('images', small, img.name);
    }

    const res = await fetch('/api/parse-pdf', { method: 'POST', body: form });
    const data = await res.json() as { text?: string; error?: string };
    if (!res.ok) throw new Error(data.error || 'Failed to read slide images with AI vision');
    if (data.text) texts.push(data.text);

    done += batch.length;
    onProgress?.(done, images.length);
  }

  return texts.join('\n\n');
}
