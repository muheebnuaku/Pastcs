import OpenAI from 'openai';
import { sampleContent } from '@/lib/utils';
import { logAiUsage } from '@/lib/aiUsage';

// Raised from 120 -> 180 -> 240: an uncapped lesson takes proportionally
// longer to stream out, and a much larger prompt (see MAX_CONTENT_CHARS)
// adds real prefill time before the first output token even starts —
// both count against this, not just time-to-first-byte.
export const maxDuration = 240;

// Per-call safety net (whether this is a whole small document or one
// batch of a larger one — see mode/batching below). Sized against
// gpt-4o's real 128,000-token context budget rather than picked
// arbitrarily: 128k total - 16k reserved for the completion - ~1.5k for
// the prompt template itself leaves ~110k tokens for content. At a
// conservative 2.5 chars/token (denser than plain English prose, to
// leave margin for tables, code, or non-English text in the source)
// that's a safe ceiling around 275,000 characters — 250,000 keeps a
// real buffer under that.
const MAX_CONTENT_CHARS = 250000;

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

const DOC_KIND_GUIDANCE = `FIRST, read what kind of document this is — the two most common cases:
- LECTURE SLIDES / COURSE NOTES: bullet-heavy, definitional, organized as a sequence of topics.
- A SCHOLARLY PAPER / ARTICLE / REPORT: has things like an abstract, citations, a methodology, findings, a discussion of significance or limitations.
Let that judgment shape both how deep you go and what the sections below actually contain — the structure names stay the same, but a paper's "concept" sections should engage with its argument and evidence critically, not just summarize it as neutral fact.`;

function coverageGuidance(scope: string): string {
  return `COVERAGE — this is critical: identify every distinct topic, idea, or claim actually present in ${scope} and cover ALL of them. Do not stop early or run out of room on the first few and rush or drop the rest. Do not compress this into a brief overview — a student should finish this lesson actually understanding every concept well enough to apply it, not just recognize its name. You have generous room to write in, but it is not infinite: if ${scope === 'the document' ? 'the document is' : 'this is'} exceptionally large (well beyond a normal lecture module's worth of material), write each section a bit more concisely rather than at full length — leaving every topic covered at a slightly tighter length beats covering only the first half in full and dropping the rest.`;
}

const CONCEPT_SECTION_SPEC = `## <Concept or idea name>
One section like this per major concept (lecture material) or per key idea/claim/finding (a paper), in the order that makes them easiest to follow — usually the document's own order. The number of sections is NOT capped — create exactly as many as the material genuinely contains. A short single-topic handout might only need 3-4; a long, content-rich deck spanning many distinct ideas might genuinely need 15 or more. Never merge two distinct concepts into one section, and never skip or fold a topic into a passing mention, just to keep the section count low — undercovering the material is the one failure mode to avoid above all others here. Each section must weave together, as flowing prose (not labeled sub-parts), and should typically run 150–300 words — long enough to actually teach the idea, not a two-sentence gloss:
- A plain-English statement of the idea, with the key term in **bold** the first time it appears
- Why it matters and how it connects to the section before it
- A step-by-step explanation, simple before complex, OR — for a paper — the evidence/reasoning actually offered for it
- One concrete real-world example or analogy that clarifies the mechanism
- For lecture material: a common mistake or point of confusion, if there's one worth flagging. For a paper: a limitation, an open question, or a competing view worth noting, if there's one worth flagging.`;

const FORMAT_RULES = `FORMATTING RULES (the renderer only understands these — anything else won't display correctly):
- "##" only for top-level sections — never use "###" or deeper headings.
- "**bold**" for key terms and emphasis, "*italic*" sparingly.
- "- " for bullet lists, "1. " for ordered steps. Never nest a list inside another list.
- Use a Markdown table (| col | col | with a |---|---| header separator row) when comparing multiple items across attributes, or presenting a dataset/record set the reader needs to see — the renderer now supports these.
- Keep paragraphs short: 2–4 sentences before a break.`;

function depthGuidance(context?: string): string {
  const base = 'DEPTH: Calibrate to the material itself, not an assumed audience — dense, technical, citation-heavy source material earns a rigorous, critical treatment; introductory, example-heavy source material earns a more foundational one. Never talk down to an advanced reader, and never leave a genuine newcomer guessing at undefined terms.';
  if (!context) return base;
  return `${base} Course context: ${context} — use this as a secondary signal (e.g. an earlier level suggests less assumed background) but let the document's own sophistication take priority when the two point in different directions, such as advanced source material in an intro-level course.`;
}

// ── Prompt builders ──────────────────────────────────────────────────────
// Four modes:
// - full (no mode / small document): the whole lesson in one call — the
//   original, unchanged behavior for anything that fits in one request.
// - first / continue: a long document is split client-side (see
//   chunkContent in lib/utils.ts, same page/slide-boundary chunking the
//   AI Question Generator uses) into sequential batches. "first" writes
//   the Introduction plus concept sections for the opening batch;
//   "continue" writes only concept sections for each later batch, told
//   what's already been covered so it doesn't repeat itself. Neither
//   writes Practice Review or Summary — a lesson's closing sections need
//   to reflect EVERYTHING covered, not just one batch's slice of it.
// - synthesize: runs once, after every batch is done, given the full set
//   of already-written concept sections (not the original document) and
//   writes just Practice Review + Summary, scaled to how much was
//   actually covered.

function buildFullPrompt(content: string, context?: string): string {
  return `Turn the document content below into a complete, well-structured lesson.

${DOC_KIND_GUIDANCE}

${coverageGuidance('the document')}

STRUCTURE — respond with Markdown using EXACTLY this shape:

## Introduction
For lecture material: why this topic matters and what the student will be able to do by the end. For a paper: what the paper is actually arguing or contributing, in plain terms, before any of the detail. 2–4 sentences either way. Speak directly to the student.

${CONCEPT_SECTION_SPEC}

## Practice Review
Roughly one question per concept section above (so a lesson with 12 sections gets around 12 questions) — minimum 5, no maximum. Checking understanding of the material above, formatted EXACTLY like this with a blank line between each pair:
**Q1.** question text
*Answer:* answer text
For lecture material, mix straightforward recall with questions that apply a concept to a short scenario (at least a third of the total). For a paper, favor questions that ask the reader to evaluate, compare, or apply its argument rather than just recite it.

## Summary
The most important things to remember, as a bulleted list ("- "), one clear sentence each — enough bullets to genuinely represent everything covered above (roughly one per concept section, so this scales with the lesson the same way Practice Review does), not capped at a fixed count.

${FORMAT_RULES}

${depthGuidance(context)}

Document Content:
${content}`;
}

function buildFirstBatchPrompt(content: string, context: string | undefined, batchTotal: number): string {
  return `This document is long enough that it's being processed in ${batchTotal} sequential parts so nothing gets rushed or dropped — you are writing part 1. Turn the excerpt below (the OPENING part of a larger document) into the START of a complete lesson: an Introduction, then concept sections for everything genuinely covered in THIS excerpt. Do NOT write a Practice Review or Summary section — a later step covers those for the whole lesson once every part has been processed, so leave them out entirely here, even if this excerpt feels self-contained.

${DOC_KIND_GUIDANCE}

${coverageGuidance('this excerpt')}

STRUCTURE — respond with Markdown using EXACTLY this shape:

## Introduction
Written for the WHOLE lesson even though you're only seeing its opening part — introduce the general subject in plain terms and what the student will be able to do by the end. 2–4 sentences. Speak directly to the student.

${CONCEPT_SECTION_SPEC}

${FORMAT_RULES}

${depthGuidance(context)}

Document excerpt — part 1 of ${batchTotal}:
${content}`;
}

function buildContinuePrompt(content: string, context: string | undefined, batchIndex: number, batchTotal: number, priorTitles: string[]): string {
  const priorList = priorTitles.length > 0
    ? priorTitles.map(t => `- ${t}`).join('\n')
    : '(none yet)';
  return `This document is long enough that it's being processed in ${batchTotal} sequential parts so nothing gets rushed or dropped — you are writing part ${batchIndex + 1}. Continue the SAME lesson already in progress: write ONLY concept sections for the NEW topics covered in the excerpt below. Do NOT write an Introduction (already written in part 1) or a Practice Review / Summary (a later step covers those for the whole lesson once every part is done).

Concepts already covered in earlier parts of this same lesson — do not repeat these. If this excerpt continues one of them with more detail, treat it as part of that same idea rather than opening a new section for it:
${priorList}

${DOC_KIND_GUIDANCE}

${coverageGuidance('this excerpt')}

STRUCTURE — respond with Markdown containing ONLY concept sections, in this exact shape:

${CONCEPT_SECTION_SPEC}

${FORMAT_RULES}

${depthGuidance(context)}

Document excerpt — part ${batchIndex + 1} of ${batchTotal}:
${content}`;
}

function buildSynthesizePrompt(conceptSections: string, context?: string): string {
  return `Below is a complete set of lesson concept sections, already written, covering everything in a document that was processed in multiple parts because of its length. Your only job now is to add the two closing sections a lesson needs. Do not rewrite, shorten, repeat, or comment on the concept sections themselves — only add what's described below.

## Practice Review
Roughly one question per concept section below (so 12 concept sections gets around 12 questions) — minimum 5, no maximum. Checking understanding of the material below, formatted EXACTLY like this with a blank line between each pair:
**Q1.** question text
*Answer:* answer text
Mix straightforward recall with questions that apply a concept to a short scenario (at least a third of the total) — or, if the source reads as scholarly material, favor questions that ask the reader to evaluate, compare, or apply its argument rather than just recite it.

## Summary
The most important things to remember, as a bulleted list ("- "), one clear sentence each — enough bullets to genuinely represent everything covered below (roughly one per concept section), not capped at a fixed count.

Respond with Markdown containing ONLY these two sections, in exactly this shape (no Introduction, no repeated concept sections):

${FORMAT_RULES}

${depthGuidance(context)}

Lesson concept sections already written:
${conceptSections}`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      text?: string;
      context?: string;
      mode?: 'first' | 'continue' | 'synthesize';
      batchIndex?: number;
      batchTotal?: number;
      priorConceptTitles?: string[];
      conceptSections?: string;
    };

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    let userMessage: string;

    if (body.mode === 'synthesize') {
      if (!body.conceptSections?.trim()) {
        return Response.json({ error: 'No concept sections provided' }, { status: 400 });
      }
      userMessage = buildSynthesizePrompt(sampleContent(body.conceptSections, MAX_CONTENT_CHARS), body.context);
    } else {
      if (!body.text?.trim()) {
        return Response.json({ error: 'No document content provided' }, { status: 400 });
      }
      const sampled = sampleContent(body.text, MAX_CONTENT_CHARS);
      if (body.mode === 'first') {
        userMessage = buildFirstBatchPrompt(sampled, body.context, body.batchTotal ?? 1);
      } else if (body.mode === 'continue') {
        userMessage = buildContinuePrompt(sampled, body.context, body.batchIndex ?? 0, body.batchTotal ?? 1, body.priorConceptTitles ?? []);
      } else {
        userMessage = buildFullPrompt(sampled, body.context);
      }
    }

    const stream = openai.chat.completions.stream({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.7,
      // Matches generate-questions' ceiling — gpt-4o's practical output
      // limit. A lesson covering many concept sections at 150-300 words
      // each, plus practice questions and a summary, can genuinely need
      // this much room.
      max_tokens: 16000,
      stream_options: { include_usage: true }, // the final chunk carries token usage
    });

    const readable = new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content ?? '';
          if (delta) controller.enqueue(new TextEncoder().encode(delta));
          if (chunk.usage) {
            logAiUsage('generate_lesson', 'gpt-4o', chunk.usage, undefined, body.mode
              ? { mode: body.mode, batchIndex: body.batchIndex, batchTotal: body.batchTotal }
              : undefined
            ).catch(() => {});
          }
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
