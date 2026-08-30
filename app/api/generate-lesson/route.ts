import OpenAI from 'openai';
import { sampleContent } from '@/lib/utils';

export const maxDuration = 120;

// Lecture slides text is almost always well within gpt-4o's context
// window — the old 8,000-character cap was silently dropping everything
// past roughly the first few slides, with no indication to the student
// that the lesson only covered part of what they uploaded. This only
// samples (start + middle + end) for genuinely oversized documents.
const MAX_CONTENT_CHARS = 60000;

const SYSTEM_PROMPT = `You are an expert university professor and a genuinely gifted teacher — the kind students remember. You turn dense lecture material into lessons that actually make sense.

Your teaching method:
- Teach ONE concept at a time. Never introduce a second idea before the first is fully landed.
- Scaffold: start from what the student almost certainly already knows or can intuit, then build up.
- Define every technical term in plain English the moment it first appears — never assume a word is already understood.
- Connect each new concept explicitly to the one before it, so the lesson reads as a single thread, not a list of disconnected facts.
- Use one concrete, relatable analogy or real-world example per concept — not a generic one bolted on, but one that actually illuminates why the concept works the way it does.
- Flag common misconceptions or mistakes where they're likely, and correct them directly.
- Be warm and encouraging, but never pad with empty motivational filler — every sentence should teach something.
- Speak directly to the student using "you" and "we".`;

const LESSON_PROMPT = `Turn the document content below into a complete, well-structured lesson.

COVERAGE — this is critical: identify every distinct topic or concept actually present in the document and teach ALL of them. Do not stop early or run out of room on the first two topics and rush the rest. If the material is dense, favor giving every topic solid, clear coverage over exhaustively over-explaining only the first ones.

STRUCTURE — respond with Markdown using EXACTLY this shape:

## Introduction
Why this topic matters and what the student will be able to do by the end. 2–4 sentences. Speak directly to the student.

## <Concept name>
One section like this per major concept in the document, in the order that makes them easiest to follow (usually the document's own order). Create as many as the material genuinely contains — typically 4 to 8 — never fewer than 3, never more than 10. Each concept section must weave together, as flowing prose (not labeled sub-parts):
- A plain-English definition of the concept, with the key term in **bold** the first time it appears
- Why it matters and how it connects to the concept before it
- A step-by-step explanation, simple before complex
- One concrete real-world analogy or example that actually clarifies the mechanism
- A common mistake or point of confusion about it, if there is one worth flagging

## Practice Review
5 questions checking understanding of the concepts above, formatted EXACTLY like this with a blank line between each pair:
**Q1.** question text
*Answer:* answer text
Mix straightforward recall with at least 2 questions that require applying the concept to a short scenario, not just repeating a definition.

## Summary
The 6 most important things to remember, as a bulleted list ("- "), one clear sentence each.

FORMATTING RULES (the renderer only understands these — anything else won't display correctly):
- "##" only for the top-level sections above — never use "###" or deeper headings.
- "**bold**" for key terms and emphasis, "*italic*" sparingly.
- "- " for bullet lists, "1. " for ordered steps. Never nest a list inside another list.
- Never use a Markdown table — it will render as broken text. Describe comparisons in prose or a bullet list instead.
- Keep paragraphs short: 2–4 sentences before a break.

{DEPTH_GUIDANCE}

Document Content:
{CONTENT}`;

function depthGuidance(context?: string): string {
  if (!context) {
    return 'DEPTH: No course context was given — write for someone encountering this exact material for the first time. Be accessible without being condescending.';
  }
  return `DEPTH: This is for ${context}. Calibrate accordingly — for an earlier level (100/200), assume no prior exposure and define foundational terms. For a later level (300/400), assume the student already has the basics of the subject area and focus your depth on what's new in this material rather than re-teaching fundamentals they'd find obvious. Never talk down to the student.`;
}

export async function POST(req: Request) {
  try {
    const { text, context } = await req.json() as { text: string; context?: string };
    if (!text?.trim()) {
      return Response.json({ error: 'No document content provided' }, { status: 400 });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const sampled = sampleContent(text, MAX_CONTENT_CHARS);
    const userMessage = LESSON_PROMPT
      .replace('{DEPTH_GUIDANCE}', depthGuidance(context))
      .replace('{CONTENT}', sampled);

    const stream = openai.chat.completions.stream({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.7,
      max_tokens: 12000,
    });

    const readable = new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content ?? '';
          if (delta) controller.enqueue(new TextEncoder().encode(delta));
        }
        controller.close();
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Failed to generate lesson' },
      { status: 500 }
    );
  }
}
