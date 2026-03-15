import OpenAI from 'openai';
import { extractText } from 'unpdf';

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const MIN_TEXT_LENGTH = 150;

const ACCEPTED_TYPES = ['application/pdf', PPTX_MIME];

// ── PPTX text extraction ────────────────────────────────────────────────────
// PPTX is a ZIP file; slides live at ppt/slides/slideN.xml.
// Text content is wrapped in <a:t> tags. We parse this without any DOM APIs.
async function extractPptxText(buffer: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const JSZip = require('jszip') as typeof import('jszip');
  const zip = await JSZip.loadAsync(buffer);

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
  return parts.join('\n\n');
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return Response.json({ error: 'No file provided' }, { status: 400 });
    }
    if (!ACCEPTED_TYPES.includes(file.type)) {
      return Response.json({ error: 'File must be a PDF or PPTX' }, { status: 400 });
    }
    if (!process.env.OPENAI_API_KEY) {
      return Response.json({ error: 'OpenAI API key not configured' }, { status: 500 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const isPptx = file.type === PPTX_MIME;

    // ── Stage 1: text extraction ────────────────────────────────────────────
    let text = '';
    try {
      if (isPptx) {
        text = await extractPptxText(buffer);
      } else {
        const { text: extracted } = await extractText(new Uint8Array(buffer), { mergePages: true });
        text = (extracted as string)?.trim() ?? '';
      }
    } catch {
      // fall through to OpenAI vision fallback (PDF only — PPTX must have text)
      if (isPptx) {
        return Response.json({ error: 'Could not read this PPTX file' }, { status: 422 });
      }
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    let detectedTopic = '';

    if (text.length >= MIN_TEXT_LENGTH) {
      // ── Text-rich file: detect topic only ──────────────────────────────────
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{
          role: 'user',
          content: `Identify the main academic topic or chapter title from this lecture slide content. Respond with only a JSON object.\n\nContent:\n${text.slice(0, 3000)}\n\nRespond: {"topic": "short topic name here"}`,
        }],
        response_format: { type: 'json_object' },
        max_tokens: 80,
        temperature: 0.2,
      });
      try {
        const r = JSON.parse(completion.choices[0].message.content || '{}');
        detectedTopic = r.topic || '';
      } catch { /* keep empty */ }

    } else if (!isPptx) {
      // ── Image-based PDF: upload to OpenAI Files API for vision OCR ─────────
      const uploadForm = new FormData();
      uploadForm.append('file', new Blob([buffer], { type: 'application/pdf' }), file.name || 'slide.pdf');
      uploadForm.append('purpose', 'user_data');

      const uploadRes = await fetch('https://api.openai.com/v1/files', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: uploadForm,
      });
      const uploaded = await uploadRes.json() as { id?: string; error?: { message: string } };

      if (!uploaded.id) {
        return Response.json(
          { error: uploaded.error?.message || 'Failed to upload PDF for scanning' },
          { status: 500 }
        );
      }

      try {
        const completionRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o',
            messages: [{
              role: 'user',
              content: [
                { type: 'file', file: { file_id: uploaded.id } },
                {
                  type: 'text',
                  text: 'Extract ALL readable text from this PDF slide, including text visible inside images or screenshots. Then identify the main academic topic or chapter title. Return only JSON: {"text": "all extracted text here", "topic": "short topic name"}',
                },
              ],
            }],
            response_format: { type: 'json_object' },
            max_tokens: 4096,
          }),
        });

        const data = await completionRes.json() as {
          choices?: Array<{ message: { content: string } }>;
          error?: { message: string };
        };

        if (data.error) throw new Error(data.error.message);
        const r = JSON.parse(data.choices?.[0]?.message?.content || '{}');
        text = r.text || '';
        detectedTopic = r.topic || '';
      } finally {
        await fetch(`https://api.openai.com/v1/files/${uploaded.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        }).catch(() => {});
      }
    }

    if (!text) {
      return Response.json({ error: 'Could not extract text from this file' }, { status: 422 });
    }

    return Response.json({ text, detectedTopic });
  } catch (err: unknown) {
    console.error('Slide parse error:', err);
    return Response.json(
      { error: err instanceof Error ? err.message : 'Failed to parse file' },
      { status: 500 }
    );
  }
}
