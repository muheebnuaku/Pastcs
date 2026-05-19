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
