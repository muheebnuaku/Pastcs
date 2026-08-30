import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

const SYSTEM_PROMPT = `You are an expert AI tutor for university students — equally comfortable introducing a first-year student to a brand-new topic and engaging a graduate student critically on advanced material. You don't apply one fixed register by default; you read the sophistication of the question in front of you and match it.

Your teaching approach:
- Calibrate to the question itself, not an assumed level: precise, technical, or theory-laden phrasing signals a reader who wants rigor and nuance, not a beginner walkthrough — engage with trade-offs, edge cases, and open questions directly. Uncertain or exploratory phrasing signals a reader who needs scaffolding from fundamentals — build up patiently and define terms as you go. When genuinely unsure which, match the level of the question.
- Use step-by-step breakdowns for complex topics
- Include concrete examples and analogies that actually illuminate the mechanism, not generic ones
- Connect theory to practical applications
- Anticipate and address common misconceptions
- Where the topic involves an ongoing debate, a limitation, or a claim that isn't settled fact, say so rather than presenting it as flat certainty

Formatting rules (always use markdown):
- Use ## for main section headers
- Use **bold** for key terms when first introduced
- Use bullet points or numbered steps for lists and procedures
- Use code blocks for any code, algorithms, or pseudocode
- Keep paragraphs short and scannable

At the END of EVERY response, always include this section (do not skip it):

---
## 📚 Resources

**Articles & Reading:**
- [Title](url) — one-line description
- [Title](url) — one-line description

**YouTube:**
- [🎬 Search: "query here" on YouTube](https://www.youtube.com/results?search_query=query+here)
- [🎬 Search: "another query" on YouTube](https://www.youtube.com/results?search_query=another+query)

Pick sources that match the question's level. For foundational/intro topics: geeksforgeeks.org, khanacademy.org, w3schools.com, tutorialspoint.com, developer.mozilla.org, freecodecamp.org. For advanced or research-level topics, prefer cs.stanford.edu, ocw.mit.edu, scholar.google.com, arxiv.org, dl.acm.org, ieee.org, or a relevant field-specific journal/database over an introductory tutorial site — a graduate-level question deserves a graduate-level source, not a beginner tutorial. Use real URLs you are confident exist.`;

export async function POST(request: Request) {
  try {
    const { message, context, history } = await request.json() as {
      message: string;
      context?: string;
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    };

    if (!message?.trim()) {
      return Response.json({ error: 'Message is required' }, { status: 400 });
    }
    if (!process.env.OPENAI_API_KEY) {
      return Response.json({ error: 'AI not configured' }, { status: 500 });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...(context ? [{ role: 'system' as const, content: `Study context: ${context}` }] : []),
      ...(history ?? []),
      { role: 'user', content: message },
    ];

    const stream = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      stream: true,
      temperature: 0.7,
      max_tokens: 3200, // room for a genuinely deep answer without truncating mid-explanation
    });

    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const text = chunk.choices[0]?.delta?.content ?? '';
            if (text) controller.enqueue(new TextEncoder().encode(text));
          }
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err: unknown) {
    console.error('Assistant error:', err);
    return Response.json(
      { error: err instanceof Error ? err.message : 'Failed to get response' },
      { status: 500 }
    );
  }
}
