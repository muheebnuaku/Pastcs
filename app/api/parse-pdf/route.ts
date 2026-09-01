import OpenAI from 'openai';
import { extractText } from 'unpdf';
import { withOpenAIRetry } from '@/lib/openaiRetry';
import { logAiUsage } from '@/lib/aiUsage';
import { sampleContent } from '@/lib/utils';

// Shared by both topic-detection call sites below. A prompt that only
// reads the opening of the document tends to grab whatever running
// header, course code, or chapter title repeats at the top of every
// slide — so two uploads with genuinely different content but the same
// header end up tagged with the identical topic. Sampling the start,
// middle, and end (not just the start) surfaces the content that
// actually varies, and the instruction spells out to prefer that over
// boilerplate that repeats unchanged.
function topicDetectionPrompt(text: string): string {
  return `Identify the specific topic actually being taught in this lecture content — not a repeated running header, footer, course code, or chapter title that appears unchanged across every slide. Base it on the concepts, definitions, and examples that are actually present. If a heading and the real content disagree (e.g. the heading is a generic chapter name but the slides cover one particular concept within it), go with the content. Respond with only a JSON object.

Content:
${sampleContent(text, 6000)}

Respond: {"topic": "short topic name here"}`;
}

export const maxDuration = 60;

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const OLD_PPT_MIME = 'application/vnd.ms-powerpoint';
const OLD_DOC_MIME = 'application/msword';
const MIN_TEXT_LENGTH = 150;

const ACCEPTED_TYPES = ['application/pdf', PPTX_MIME, DOCX_MIME];

// A page with fewer characters than this is almost certainly a
// diagram, screenshot, or photo rather than a text slide — pure text
// extraction returns next to nothing for it even though it may carry
// real content a student needs questions generated from.
const SPARSE_PAGE_CHARS = 40;

interface VisionOcrResult { text: string; topic: string }

// Uploads the raw PDF to OpenAI's Files API and asks a vision-capable
// model to read it directly (including text baked into images/diagrams),
// then deletes the upload. Shared by both the "almost no text at all"
// case and the "some pages are graphics-heavy" case below.
async function runVisionOcr(buffer: Buffer<ArrayBuffer>, filename: string, apiKey: string): Promise<VisionOcrResult> {
  const uploadForm = new FormData();
  uploadForm.append('file', new Blob([buffer], { type: 'application/pdf' }), filename || 'slide.pdf');
  uploadForm.append('purpose', 'user_data');

  const uploadRes = await fetch('https://api.openai.com/v1/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: uploadForm,
  });
  const uploaded = await uploadRes.json() as { id?: string; error?: { message: string } };
  if (!uploaded.id) {
    throw new Error(uploaded.error?.message || 'Failed to upload PDF for scanning');
  }

  try {
    const completionRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
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
              text: 'Extract ALL readable text and content from this PDF slide deck, including text, labels, and data visible inside images, diagrams, charts, or screenshots — describe what a diagram or chart shows if it has no text of its own. Then identify the specific topic actually being taught — based on the concepts and content present, not a running header, footer, course code, or chapter title that just repeats unchanged across every slide. Return only JSON: {"text": "all extracted text and diagram descriptions here", "topic": "short topic name"}',
            },
          ],
        }],
        response_format: { type: 'json_object' },
        max_tokens: 4096,
      }),
    });

    const data = await completionRes.json() as {
      choices?: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      error?: { message: string };
    };

    if (data.error) throw new Error(data.error.message);
    logAiUsage('parse_pdf_vision_ocr', 'gpt-4o', data.usage).catch(() => {});
    const r = JSON.parse(data.choices?.[0]?.message?.content || '{}');
    return { text: r.text || '', topic: r.topic || '' };
  } finally {
    await fetch(`https://api.openai.com/v1/files/${uploaded.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${apiKey}` },
    }).catch(() => {});
  }
}

// ── DOCX text extraction ────────────────────────────────────────────────────
async function extractDocxText(buffer: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const JSZip = require('jszip') as typeof import('jszip');
  const zip = await JSZip.loadAsync(buffer);
  const docXml = await zip.files['word/document.xml']?.async('text');
  if (!docXml) return '';
  const texts = docXml.match(/<w:t[^>]*>[^<]*<\/w:t>/g) ?? [];
  return texts.map(t => t.replace(/<[^>]+>/g, '')).join(' ').replace(/\s+/g, ' ').trim();
}

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
    const contentType = request.headers.get('content-type') ?? '';

    // ── JSON path: client already extracted the text (large PDF) ───────────
    if (contentType.includes('application/json')) {
      const { text, pageCount } = await request.json() as { text: string; pageCount?: number };
      if (!text?.trim()) return Response.json({ error: 'No text provided' }, { status: 400 });
      if (!process.env.OPENAI_API_KEY) return Response.json({ text, detectedTopic: '' });

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      let detectedTopic = '';
      try {
        const r = await withOpenAIRetry(() => openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: topicDetectionPrompt(text) }],
          response_format: { type: 'json_object' },
          max_tokens: 80,
          temperature: 0.2,
        }));
        logAiUsage('parse_pdf_topic', 'gpt-4o', r.usage).catch(() => {});
        detectedTopic = JSON.parse(r.choices[0].message.content || '{}').topic || '';
      } catch { /* topic detection optional */ }
      return Response.json({ text, detectedTopic, pageCount });
    }

    // ── FormData path: file upload (PPTX / DOCX) ───────────────────────────
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return Response.json({ error: 'No file provided' }, { status: 400 });
    }

    // Reject old binary formats with a helpful message
    if (file.type === OLD_PPT_MIME) {
      return Response.json({ error: 'Old .ppt format is not supported. Please save as .pptx in PowerPoint and try again.' }, { status: 415 });
    }
    if (file.type === OLD_DOC_MIME) {
      return Response.json({ error: 'Old .doc format is not supported. Please save as .docx in Word and try again.' }, { status: 415 });
    }

    if (!ACCEPTED_TYPES.includes(file.type)) {
      return Response.json({ error: 'Unsupported file type. Use PDF, PPTX, or DOCX.' }, { status: 400 });
    }
    if (!process.env.OPENAI_API_KEY) {
      return Response.json({ error: 'OpenAI API key not configured' }, { status: 500 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const isPptx = file.type === PPTX_MIME;
    const isDocx = file.type === DOCX_MIME;
    const apiKey = process.env.OPENAI_API_KEY;

    // ── Stage 1: text extraction ────────────────────────────────────────────
    let text = '';
    let sparsePageCount = 0;
    let totalPageCount = 0;
    try {
      if (isPptx) {
        text = await extractPptxText(buffer);
      } else if (isDocx) {
        text = await extractDocxText(buffer);
      } else {
        // Per-page (not merged) so a graphics-heavy slide buried in an
        // otherwise text-rich deck can still be detected below — a
        // whole-document length check alone would never notice it.
        const { text: pages, totalPages } = await extractText(new Uint8Array(buffer), { mergePages: false });
        totalPageCount = totalPages;
        sparsePageCount = pages.filter(p => p.trim().length < SPARSE_PAGE_CHARS).length;
        text = pages.join('\n\n').trim();
      }
    } catch {
      // fall through to OpenAI vision fallback (PDF only — PPTX/DOCX must have text)
      if (isPptx) return Response.json({ error: 'Could not read this PPTX file' }, { status: 422 });
      if (isDocx) return Response.json({ error: 'Could not read this DOCX file' }, { status: 422 });
    }

    const openai = new OpenAI({ apiKey });
    let detectedTopic = '';

    // At least one sparse page, and either they're a meaningful share of
    // the deck or it's a small deck where even one matters.
    const hasGraphicsHeavyPages = sparsePageCount > 0
      && (sparsePageCount / Math.max(totalPageCount, 1) >= 0.1 || totalPageCount <= 3);

    if (text.length >= MIN_TEXT_LENGTH && !hasGraphicsHeavyPages) {
      // ── Text-rich file, no graphics-heavy pages: detect topic only ─────────
      const completion = await withOpenAIRetry(() => openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: topicDetectionPrompt(text) }],
        response_format: { type: 'json_object' },
        max_tokens: 80,
        temperature: 0.2,
      }));
      logAiUsage('parse_pdf_topic', 'gpt-4o', completion.usage).catch(() => {});
      try {
        const r = JSON.parse(completion.choices[0].message.content || '{}');
        detectedTopic = r.topic || '';
      } catch { /* keep empty */ }

    } else if (!isPptx && !isDocx && apiKey) {
      // ── PDF with too little text overall, OR some graphics-heavy pages
      // mixed into an otherwise text-rich deck: run vision OCR and either
      // use it outright (nothing else to go on) or merge it in alongside
      // what plain extraction already found (don't throw that away).
      try {
        const vision = await runVisionOcr(buffer, file.name, apiKey);
        if (text.length >= MIN_TEXT_LENGTH) {
          text = `${text}\n\n[...additional content from graphics/diagrams, read via AI vision...]\n\n${vision.text}`;
        } else {
          text = vision.text;
        }
        detectedTopic = vision.topic;
      } catch (err) {
        // Only fatal if plain extraction had nothing at all to fall back on.
        if (text.length < MIN_TEXT_LENGTH) {
          return Response.json(
            { error: err instanceof Error ? err.message : 'Failed to scan graphics on this PDF' },
            { status: 500 }
          );
        }
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
