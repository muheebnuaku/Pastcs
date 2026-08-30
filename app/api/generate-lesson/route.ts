import OpenAI from 'openai';
import { sampleContent } from '@/lib/utils';
import { logAiUsage } from '@/lib/aiUsage';

export const maxDuration = 120;

// Lecture slides text is almost always well within gpt-4o's context
// window — the old 8,000-character cap was silently dropping everything
// past roughly the first few slides, with no indication to the student
// that the lesson only covered part of what they uploaded. This only
// samples (start + middle + end) for genuinely oversized documents.
const MAX_CONTENT_CHARS = 60000;

const SYSTEM_PROMPT = `You are an expert teacher — the kind students remember — equally capable of introducing a first-year student to a brand-new topic and engaging a graduate student critically with a research paper. You never apply one register by default; you read what you've been given and match it.

Your teaching method:
- Teach ONE idea at a time. Never introduce a second idea before the first is fully landed.
- Scaffold from wherever the material's own sophistication suggests the student already stands — dense, citation-heavy, jargon-fluent source material signals a reader who doesn't need definitions of the basics; simple, example-heavy source material signals a reader who does. Match it. Never pad an advanced reader with beginner hand-holding, and never leave a genuine beginner guessing at undefined terms.
- Define any term the material itself doesn't already assume as known, the moment it first appears.
- Connect each idea explicitly to the one before it, so the lesson reads as a single thread, not a list of disconnected facts.
- Where the source material makes a claim, a methodological choice, or an argument, engage with it — note its strength, a limitation, an open question, or a competing view, rather than just restating it as settled fact. This matters most for scholarly material and matters less for a straightforward lecture-slide definition.
- Use one concrete, real example or analogy per idea — not a generic one bolted on, but one that actually illuminates why it works the way it does.
- Be warm and direct, but never pad with empty motivational filler — every sentence should teach something.
- Speak to the student using "you" and "we".`;

const LESSON_PROMPT = `Turn the document content below into a complete, well-structured lesson.

FIRST, read what kind of document this is — the two most common cases:
- LECTURE SLIDES / COURSE NOTES: bullet-heavy, definitional, organized as a sequence of topics.
- A SCHOLARLY PAPER / ARTICLE / REPORT: has things like an abstract, citations, a methodology, findings, a discussion of significance or limitations.
Let that judgment shape both how deep you go and what the sections below actually contain — the structure names stay the same, but a paper's "concept" sections should engage with its argument and evidence critically, not just summarize it as neutral fact.

COVERAGE — this is critical: identify every distinct topic, idea, or claim actually present in the document and cover ALL of them. Do not stop early or run out of room on the first two and rush the rest. If the material is dense, favor giving every part solid, clear coverage over exhaustively over-explaining only the first ones.

STRUCTURE — respond with Markdown using EXACTLY this shape:

## Introduction
For lecture material: why this topic matters and what the student will be able to do by the end. For a paper: what the paper is actually arguing or contributing, in plain terms, before any of the detail. 2–4 sentences either way. Speak directly to the student.

## <Concept or idea name>
One section like this per major concept (lecture material) or per key idea/claim/finding (a paper), in the order that makes them easiest to follow — usually the document's own order. Create as many as the material genuinely contains — typically 4 to 8 — never fewer than 3, never more than 10. Each section must weave together, as flowing prose (not labeled sub-parts):
- A plain-English statement of the idea, with the key term in **bold** the first time it appears
- Why it matters and how it connects to the section before it
- A step-by-step explanation, simple before complex, OR — for a paper — the evidence/reasoning actually offered for it
- One concrete real-world example or analogy that clarifies the mechanism
- For lecture material: a common mistake or point of confusion, if there's one worth flagging. For a paper: a limitation, an open question, or a competing view worth noting, if there's one worth flagging.

## Practice Review
5 questions checking understanding of the material above, formatted EXACTLY like this with a blank line between each pair:
**Q1.** question text
*Answer:* answer text
For lecture material, mix straightforward recall with at least 2 questions that apply a concept to a short scenario. For a paper, favor questions that ask the reader to evaluate, compare, or apply its argument rather than just recite it.

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
  const base = 'DEPTH: Calibrate to the material itself, not an assumed audience — dense, technical, citation-heavy source material earns a rigorous, critical treatment; introductory, example-heavy source material earns a more foundational one. Never talk down to an advanced reader, and never leave a genuine newcomer guessing at undefined terms.';
  if (!context) return base;
  return `${base} Course context: ${context} — use this as a secondary signal (e.g. an earlier level suggests less assumed background) but let the document's own sophistication take priority when the two point in different directions, such as advanced source material in an intro-level course.`;
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
      stream_options: { include_usage: true }, // the final chunk carries token usage
    });

    const readable = new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content ?? '';
          if (delta) controller.enqueue(new TextEncoder().encode(delta));
          if (chunk.usage) logAiUsage('generate_lesson', 'gpt-4o', chunk.usage).catch(() => {});
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
