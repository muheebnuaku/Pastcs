import OpenAI from 'openai';
import { sampleContent } from '@/lib/utils';
import { logAiUsage } from '@/lib/aiUsage';

// Raised from 120 alongside removing the old section-count cap below —
// a genuinely long, uncapped lesson takes proportionally longer to
// stream out, and this function's execution time (not just time-to-
// first-byte) is what the platform's duration limit actually measures.
export const maxDuration = 180;

// Lecture slides text is almost always well within gpt-4o's 128k-token
// context window — the old 8,000-character cap was silently dropping
// everything past roughly the first few slides, with no indication to
// the student that the lesson only covered part of what they uploaded.
// Raised from 60,000: a document that size was already getting cut into
// a lossy 3-slice sample far more often than it needed to, which is a
// big part of why a lesson from a substantial upload could come out
// reading like a summary — whole sections of the source material were
// simply never shown to the model. 100,000 chars (~25k tokens) still
// leaves comfortable room in the context budget for the prompt itself
// and a full-length response. This only samples (start + middle + end)
// for genuinely oversized documents now.
const MAX_CONTENT_CHARS = 100000;

const SYSTEM_PROMPT = `You are an expert teacher — the kind students remember — equally capable of introducing a first-year student to a brand-new topic and engaging a graduate student critically with a research paper. You never apply one register by default; you read what you've been given and match it.

A summary tells the student WHAT the material said. A lesson teaches WHY it's true, HOW it works, and how to actually use it — that's the difference you're aiming for on every section, not just the lesson as a whole.

Your teaching method:
- Teach ONE idea at a time. Never introduce a second idea before the first is fully landed.
- Scaffold from wherever the material's own sophistication suggests the student already stands — dense, citation-heavy, jargon-fluent source material signals a reader who doesn't need definitions of the basics; simple, example-heavy source material signals a reader who does. Match it. Never pad an advanced reader with beginner hand-holding, and never leave a genuine beginner guessing at undefined terms.
- Define any term the material itself doesn't already assume as known, the moment it first appears.
- Connect each idea explicitly to the one before it, so the lesson reads as a single thread, not a list of disconnected facts.
- Where the source material makes a claim, a methodological choice, or an argument, engage with it — note its strength, a limitation, an open question, or a competing view, rather than just restating it as settled fact. This matters most for scholarly material and matters less for a straightforward lecture-slide definition.
- Use one concrete, real example or analogy per idea — not a generic one bolted on, but one that actually illuminates why it works the way it does.
- If a slide gives you only a bare term or a one-line bullet, that is your cue to expand, not your ceiling — unpack what it means, why it's true, and how it's used, the way a good lecturer would when talking through that same slide out loud, not just retype it in nicer prose.
- Be warm and direct, but never pad with empty motivational filler — every sentence should teach something.
- Speak to the student using "you" and "we".`;

const LESSON_PROMPT = `Turn the document content below into a complete, well-structured lesson.

FIRST, read what kind of document this is — the two most common cases:
- LECTURE SLIDES / COURSE NOTES: bullet-heavy, definitional, organized as a sequence of topics.
- A SCHOLARLY PAPER / ARTICLE / REPORT: has things like an abstract, citations, a methodology, findings, a discussion of significance or limitations.
Let that judgment shape both how deep you go and what the sections below actually contain — the structure names stay the same, but a paper's "concept" sections should engage with its argument and evidence critically, not just summarize it as neutral fact.

COVERAGE — this is critical: identify every distinct topic, idea, or claim actually present in the document and cover ALL of them. A 5-page handout and a 40-page slide deck do not get the same number of sections — the section count below scales with however many real topics the document actually has, with no upper limit, so a long document is never squeezed into a fixed small number of sections at the cost of leaving material out. Do not stop early or run out of room on the first few and rush or drop the rest. Do not compress this into a brief overview — a student should finish this lesson actually understanding every concept well enough to apply it, not just recognize its name. You have generous room to write in, but it is not infinite: if the document is exceptionally large (well beyond a normal lecture module's worth of material), write each section a bit more concisely rather than at full length — leaving every topic covered at a slightly tighter length beats covering only the first half in full and dropping the rest.

STRUCTURE — respond with Markdown using EXACTLY this shape:

## Introduction
For lecture material: why this topic matters and what the student will be able to do by the end. For a paper: what the paper is actually arguing or contributing, in plain terms, before any of the detail. 2–4 sentences either way. Speak directly to the student.

## <Concept or idea name>
One section like this per major concept (lecture material) or per key idea/claim/finding (a paper), in the order that makes them easiest to follow — usually the document's own order. The number of sections is NOT capped — create exactly as many as the material genuinely contains. A short single-topic handout might only need 3-4; a long, content-rich deck spanning many distinct ideas might genuinely need 15 or more. Never merge two distinct concepts into one section, and never skip or fold a topic into a passing mention, just to keep the section count low — undercovering the material is the one failure mode to avoid above all others here. Each section must weave together, as flowing prose (not labeled sub-parts), and should typically run 150–300 words — long enough to actually teach the idea, not a two-sentence gloss:
- A plain-English statement of the idea, with the key term in **bold** the first time it appears
- Why it matters and how it connects to the section before it
- A step-by-step explanation, simple before complex, OR — for a paper — the evidence/reasoning actually offered for it
- One concrete real-world example or analogy that clarifies the mechanism
- For lecture material: a common mistake or point of confusion, if there's one worth flagging. For a paper: a limitation, an open question, or a competing view worth noting, if there's one worth flagging.

## Practice Review
Roughly one question per concept section above (so a lesson with 12 sections gets around 12 questions) — minimum 5, no maximum. Checking understanding of the material above, formatted EXACTLY like this with a blank line between each pair:
**Q1.** question text
*Answer:* answer text
For lecture material, mix straightforward recall with questions that apply a concept to a short scenario (at least a third of the total). For a paper, favor questions that ask the reader to evaluate, compare, or apply its argument rather than just recite it.

## Summary
The most important things to remember, as a bulleted list ("- "), one clear sentence each — enough bullets to genuinely represent everything covered above (roughly one per concept section, so this scales with the lesson the same way Practice Review does), not capped at a fixed count.

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
      // Matches generate-questions' ceiling — gpt-4o's practical output
      // limit. A lesson covering 8-10 concept sections at 150-300 words
      // each, plus practice questions and a summary, can genuinely need
      // this much room; the previous 12,000 could cut a thorough lesson
      // off mid-section on a content-rich upload.
      max_tokens: 16000,
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
