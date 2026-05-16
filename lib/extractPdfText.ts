'use client';

export async function extractPdfText(
  file: File,
  onProgress?: (page: number, total: number) => void
): Promise<{ text: string; pageCount: number }> {
  const pdfjsLib = await import('pdfjs-dist');

  // Use unpkg CDN for the worker — avoids Next.js worker bundling issues
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;

  const pageCount = pdf.numPages;
  const parts: string[] = [];

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((item: any) => ('str' in item ? item.str : ''))
      .join(' ')
      .trim();
    if (pageText) parts.push(pageText);
    onProgress?.(i, pageCount);
  }

  return { text: parts.join('\n\n'), pageCount };
}
