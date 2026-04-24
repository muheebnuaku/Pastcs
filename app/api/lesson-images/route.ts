import OpenAI from 'openai';

export interface LessonImage {
  url: string;
  caption: string;
  pageUrl: string;
}

export async function POST(req: Request) {
  try {
    const { paragraphs, topic } = await req.json() as { paragraphs: string[]; topic: string };
    if (!paragraphs?.length) return Response.json({ images: {} });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Ask GPT-4o-mini which paragraphs benefit from a visual and what to search
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: `Topic: "${topic}"

For each paragraph below, decide if a Wikipedia image (diagram, photo, chart, or illustration) would genuinely help a beginner student understand it visually. If yes, give a specific Wikipedia article title to fetch an image from.

${paragraphs.map((p, i) => `[${i}] ${p.slice(0, 300)}`).join('\n\n')}

Return JSON only: {"queries": [{"index": <number>, "query": "<wikipedia article title>"}, ...]}
Be selective — only include paragraphs where a visual clearly adds value.`,
      }],
      response_format: { type: 'json_object' },
      max_tokens: 400,
      temperature: 0.2,
    });

    let queries: Array<{ index: number; query: string }> = [];
    try {
      queries = JSON.parse(completion.choices[0].message.content || '{}').queries ?? [];
    } catch {
      return Response.json({ images: {} });
    }

    // Fetch Wikipedia thumbnails in parallel
    const images: Record<number, LessonImage> = {};

    await Promise.allSettled(
      queries.map(async ({ index, query }) => {
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
            images[index] = {
              url: data.thumbnail.source,
              caption: data.description || query,
              pageUrl: data.content_urls?.desktop?.page || '',
            };
          }
        } catch { /* skip missing images silently */ }
      })
    );

    return Response.json({ images });
  } catch {
    return Response.json({ images: {} });
  }
}
