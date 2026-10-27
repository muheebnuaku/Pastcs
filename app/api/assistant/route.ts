import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { withOpenAIRetry } from '@/lib/openaiRetry';
import { logAiUsage } from '@/lib/aiUsage';
import { requireUser, aiCallsToday } from '@/lib/apiAuth';
import { buildTutorContext, TUTOR_ACTIONS, type TutorAction } from '@/lib/tutorContext';

const SYSTEM_PROMPT = `You are an expert AI tutor for university students — equally comfortable introducing a first-year student to a brand-new topic and engaging a graduate student critically on advanced material. You don't apply one fixed register by default; you read the sophistication of the question in front of you and match it.

Your teaching approach:
- Calibrate to the question itself, not an assumed level: precise, technical, or theory-laden phrasing signals a reader who wants rigor and nuance, not a beginner walkthrough — engage with trade-offs, edge cases, and open questions directly. Uncertain or exploratory phrasing signals a reader who needs scaffolding from fundamentals — build up patiently and define terms as you go. When genuinely unsure which, match the level of the question.
- Use step-by-step breakdowns for complex topics
- For any concept that isn't trivial, ground it in a short, concrete scenario — a realistic task, a small dataset, a piece of code behaving a certain way, a decision someone actually has to make — and walk through how the concept plays out in it. A scenario built from specifics beats an abstract definition every time; skip this only for genuinely simple factual questions.
- Include examples and analogies that actually illuminate the mechanism, not generic ones bolted on for form
- Connect theory to practical applications
- Anticipate and address common misconceptions
- Where the topic involves an ongoing debate, a limitation, or a claim that isn't settled fact, say so rather than presenting it as flat certainty
- When a topic has real depth to it, don't stop at the first correct answer — briefly surface the "why it matters" or "what this connects to next" so the reply teaches more than the minimum needed to technically answer the question

Formatting rules (always use markdown):
- Use ## for main section headers
- Use **bold** for key terms when first introduced
- Use bullet points or numbered steps for lists and procedures
- Use code blocks for any code, algorithms, or pseudocode
- Use a markdown table (| col | col | with a |---|---| header separator) whenever you're comparing multiple items across attributes, or referencing a specific dataset/record set the student needs to see to follow along — never describe a table's contents in prose only
- Write every formula or equation in LaTeX: \\( ... \\) for inline maths and \\[ ... \\] for a formula on its own line (it is rendered properly). Never use $ signs as maths delimiters.
- Keep paragraphs short and scannable

At the END of every response that teaches a concept, include this section (skip it for quick replies like greetings, thanks, or yes/no clarifications, and while you are in the middle of quizzing the student one question at a time):

---
## 📚 Resources

**Read more:**
- [🔎 "search terms" on GeeksforGeeks](https://www.google.com/search?q=search+terms+site%3Ageeksforgeeks.org)
- [🔎 "search terms" on Khan Academy](https://www.google.com/search?q=search+terms+site%3Akhanacademy.org)

**YouTube:**
- [🎬 Search: "query here" on YouTube](https://www.youtube.com/results?search_query=query+here)
- [🎬 Search: "another query" on YouTube](https://www.youtube.com/results?search_query=another+query)

NEVER link to a specific article, page, or video URL — you cannot verify it exists, and dead links waste the student's time. Use ONLY the two search-link formats above, with search terms specific to the question. Pick sites that match the question's level: for foundational topics geeksforgeeks.org, khanacademy.org, w3schools.com, developer.mozilla.org, freecodecamp.org; for advanced or research-level topics ocw.mit.edu, cs.stanford.edu, arxiv.org, or scholar.google.com.`;

// Daily cap on chat replies per student (shared with the results page's
// "Ask AI to explain"), so one account can't run up the OpenAI bill.
const CHAT_DAILY_LIMIT = 60;
const MAX_MESSAGE_CHARS = 4000;
const MAX_CONTEXT_CHARS = 500;
const MAX_HISTORY_MESSAGES = 10;
// Earlier replies are trimmed before being resent — the model needs the
// gist of the conversation, not every word of each long answer again.
const MAX_HISTORY_CHARS_EACH = 2500;

export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const auth = await requireUser();
    if (auth instanceof Response) return auth;

    const { message, context, history, courseId, action, source, testId } = await request.json() as {
      message?: unknown;
      context?: unknown;
      history?: unknown;
      courseId?: unknown;
      action?: unknown;
      source?: unknown;
      testId?: unknown;
    };

    // "Ask AI to explain" on a quiz review is for paid students only: the
    // test's course must be fully unlocked (migration 038), not on free
    // access. Checked as the student, against their own test.
    if (source === 'quiz_review') {
      const { data: testRow } = typeof testId === 'string'
        ? await auth.supabase.from('tests').select('course_id').eq('id', testId).maybeSingle()
        : { data: null };
      const reviewCourse = (testRow as { course_id: string } | null)?.course_id;
      if (!reviewCourse) return Response.json({ error: 'Test not found' }, { status: 404 });
      const { data: access, error: accessError } = await auth.supabase.rpc('get_course_access', { p_course: reviewCourse });
      // Before migration 038 the check doesn't exist: keep the old behaviour.
      if (!accessError && (access as { access?: string } | null)?.access !== 'full') {
        return Response.json(
          { error: 'Ask AI on quiz reviews is for paid students. Unlock all courses to use it.', code: 'paid_only' },
          { status: 402 }
        );
      }
    }
    const tutorAction: TutorAction | null =
      typeof action === 'string' && (TUTOR_ACTIONS as string[]).includes(action) ? action as TutorAction : null;

    if (typeof message !== 'string' || !message.trim()) {
      return Response.json({ error: 'Message is required' }, { status: 400 });
    }
    if (message.length > MAX_MESSAGE_CHARS) {
      return Response.json({ error: `That message is too long — keep it under ${MAX_MESSAGE_CHARS.toLocaleString()} characters, or use Paste Text for longer notes.` }, { status: 400 });
    }
    if (!process.env.OPENAI_API_KEY) {
      return Response.json({ error: 'AI not configured' }, { status: 500 });
    }

    if (await aiCallsToday(auth.userId, ['assistant_chat']) >= CHAT_DAILY_LIMIT) {
      return Response.json(
        { error: `You've reached today's limit of ${CHAT_DAILY_LIMIT} AI tutor replies. It resets at midnight (GMT).` },
        { status: 429 }
      );
    }

    // Only plain user/assistant turns are accepted from the browser — a
    // client-supplied "system" role would let anyone rewrite the tutor's
    // instructions.
    const safeHistory: ChatCompletionMessageParam[] = (Array.isArray(history) ? history : [])
      .filter((m): m is { role: 'user' | 'assistant'; content: string } =>
        !!m && typeof m === 'object' &&
        ((m as { role?: unknown }).role === 'user' || (m as { role?: unknown }).role === 'assistant') &&
        typeof (m as { content?: unknown }).content === 'string')
      .slice(-MAX_HISTORY_MESSAGES)
      .map(m => ({
        role: m.role,
        content: m.content.length > MAX_HISTORY_CHARS_EACH
          ? `${m.content.slice(0, MAX_HISTORY_CHARS_EACH)}…`
          : m.content,
      }));
    const safeContext = typeof context === 'string' ? context.slice(0, MAX_CONTEXT_CHARS) : '';

    // What we know about this student (course syllabus, weak topics, exam
    // date, latest test mistakes) — built server-side from their own data
    // so it can't be spoofed and doesn't have to be sent by the browser.
    const studentNotes = await buildTutorContext(auth.supabase, auth.userId, courseId, tutorAction)
      .catch(() => '');

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...(studentNotes ? [{ role: 'system' as const, content: studentNotes }] : []),
      ...(safeContext ? [{ role: 'system' as const, content: `Study context: ${safeContext}` }] : []),
      ...safeHistory,
      { role: 'user', content: message },
    ];

    const stream = await withOpenAIRetry(() => openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      stream: true,
      temperature: 0.7,
      max_tokens: 3200, // room for a genuinely deep answer without truncating mid-explanation
      stream_options: { include_usage: true }, // the final chunk carries token usage
    }));

    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const text = chunk.choices[0]?.delta?.content ?? '';
            if (text) controller.enqueue(new TextEncoder().encode(text));
            if (chunk.usage) logAiUsage('assistant_chat', 'gpt-4o', chunk.usage, auth.userId).catch(() => {});
          }
          controller.close();
        } catch (err) {
          // Surfaces to the browser as a failed read instead of a reply
          // that silently stops mid-sentence.
          controller.error(err);
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
