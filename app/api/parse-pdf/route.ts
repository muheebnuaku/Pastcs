import OpenAI from 'openai';

// Typed require — serverExternalPackages ensures pdf-parse is never bundled
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (
  buf: Buffer,
  options?: Record<string, unknown>
) => Promise<{ text: string; numpages: number; info: unknown }>;

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

    const buffer = Buffer.from(await file.arrayBuffer());
    const pdfData = await pdfParse(buffer);
    const text: string = pdfData.text?.trim() || '';

    if (!text) {
      return Response.json({ error: 'Could not extract text from this PDF' }, { status: 422 });
    }

    // Use OpenAI to detect the main topic from the extracted text
    let detectedTopic = '';
    if (process.env.OPENAI_API_KEY) {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: `Identify the main academic topic or chapter title from this lecture slide content. Respond with only a JSON object.\n\nContent (first 3000 chars):\n${text.slice(0, 3000)}\n\nRespond: {"topic": "short topic name here"}`,
          },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 80,
        temperature: 0.2,
      });

      try {
        const result = JSON.parse(completion.choices[0].message.content || '{}');
        detectedTopic = result.topic || '';
      } catch {
        // keep detectedTopic as empty string
      }
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
