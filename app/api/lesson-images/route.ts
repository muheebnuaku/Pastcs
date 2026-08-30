import OpenAI from 'openai';
import { withOpenAIRetry } from '@/lib/openaiRetry';
import { logAiUsage } from '@/lib/aiUsage';

export interface LessonImage {
  url: string;
  caption: string;
  pageUrl: string;
}

export async function POST(req: Request) {
  try {
    const { lessonText, topic } = await req.json() as { lessonText: string; topic: string };
    if (!lessonText) return Response.json({ images: {} });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Ask GPT-4o-mini to extract all visual keywords from the full lesson
    const completion = await withOpenAIRetry(() => openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: `You are helping a beginner student understand this lesson about "${topic}".

Extract 8-15 key technical terms or concepts from the lesson below that a beginner would benefit from seeing an image of (diagrams, structures, components, processes, etc.).

For each term:
- Use the EXACT word or short phrase as it appears in the lesson text
- Provide a Wikipedia article title that has a good illustrative image

Lesson:
${lessonText.slice(0, 6000)}

Return JSON only: {"keywords": [{"term": "exact term from lesson", "query": "Wikipedia article title"}, ...]}
Only include terms where a visual clearly helps (skip abstract/non-visual concepts).`,
      }],
      response_format: { type: 'json_object' },
      max_tokens: 700,
      temperature: 0.2,
    }));

    logAiUsage('lesson_images', 'gpt-4o-mini', completion.usage).catch(() => {});

    let keywords: Array<{ term: string; query: string }> = [];
    try {
      keywords = JSON.parse(completion.choices[0].message.content || '{}').keywords ?? [];
    } catch {
      return Response.json({ images: {} });
    }

    // Fetch Wikipedia thumbnails in parallel
    const images: Record<string, LessonImage> = {};

    await Promise.allSettled(
      keywords.map(async ({ term, query }) => {
        try {
          const res = await fetch(
            `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`,
            { headers: { 'User-Agent': 'PastCS/1.0 (educational; contact@pastcs.com)' } }
          );
          if (!res.ok) return;
          const data = await res.json() as {
            thumbnail?: { source: string };
            description?: string;
            content_urls?: { desktop?: { page: string } };
          };
          if (data.thumbnail?.source) {
            images[term.toLowerCase()] = {
              url: data.thumbnail.source,
              caption: data.description || query,
              pageUrl: data.content_urls?.desktop?.page || '',
            };
          }
        } catch { /* skip */ }
      })
    );

    return Response.json({ images });
  } catch {
    return Response.json({ images: {} });
  }
}
