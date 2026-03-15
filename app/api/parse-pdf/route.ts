import OpenAI from 'openai';
import { extractText } from 'unpdf';

// If extracted text is shorter than this, the PDF is likely image-based
const MIN_TEXT_LENGTH = 150;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return Response.json({ error: 'No PDF file provided' }, { status: 400 });
    }
    if (file.type !== 'application/pdf') {
      return Response.json({ error: 'File must be a PDF' }, { status: 400 });
    }
    if (!process.env.OPENAI_API_KEY) {
      return Response.json({ error: 'OpenAI API key not configured' }, { status: 500 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // ── Stage 1: try fast text-layer extraction ──────────────────────────────
    let text = '';
    try {
      const { text: extracted } = await extractText(new Uint8Array(buffer), { mergePages: true });
      text = (extracted as string)?.trim() || '';
    } catch {
      // unpdf failed — treat as image-based
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    let detectedTopic = '';

    if (text.length >= MIN_TEXT_LENGTH) {
      // ── Text-based PDF: text extracted; just detect the topic ───────────────
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
        const result = JSON.parse(completion.choices[0].message.content || '{}');
        detectedTopic = result.topic || '';
      } catch { /* keep empty */ }

    } else {
      // ── Image-based PDF: upload to OpenAI and let GPT-4o do OCR + topic ─────
      // Use raw fetch to avoid SDK type constraints on the newer 'file' content type
      const uploadForm = new FormData();
      uploadForm.append(
        'file',
        new Blob([buffer], { type: 'application/pdf' }),
        file.name || 'slide.pdf'
      );
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
                  text: 'Extract ALL readable text from this PDF slide, including any text visible inside images or screenshots. Then identify the main academic topic or chapter title. Return only JSON in this format: {"text": "all extracted text here", "topic": "short topic name"}',
                },
              ],
            }],
            response_format: { type: 'json_object' },
            max_tokens: 4096,
          }),
        });

        const completionData = await completionRes.json() as {
          choices?: Array<{ message: { content: string } }>;
          error?: { message: string };
        };

        if (completionData.error) throw new Error(completionData.error.message);

        const result = JSON.parse(completionData.choices?.[0]?.message?.content || '{}');
        text = result.text || '';
        detectedTopic = result.topic || '';
      } finally {
        // Clean up the uploaded file (best-effort)
        await fetch(`https://api.openai.com/v1/files/${uploaded.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        }).catch(() => {});
      }
    }

    if (!text) {
      return Response.json({ error: 'Could not extract text from this PDF' }, { status: 422 });
    }

    return Response.json({ text, detectedTopic });
  } catch (err: unknown) {
    console.error('PDF parse error:', err);
    return Response.json(
      { error: err instanceof Error ? err.message : 'Failed to parse PDF' },
      { status: 500 }
    );
  }
}
