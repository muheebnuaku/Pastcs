import OpenAI from 'openai';
import { sampleContent } from '@/lib/utils';
import { withOpenAIRetry } from '@/lib/openaiRetry';
import { logAiUsage } from '@/lib/aiUsage';

// Scale question count: ~1 question per 1000 chars, capped at 50
function targetQuestionCount(contentLength: number): number {
  if (contentLength >= 80000) return 50;
  if (contentLength >= 50000) return 40;
  if (contentLength >= 30000) return 30;
  if (contentLength >= 15000) return 20;
  if (contentLength >= 5000)  return 15;
  return 10;
}

export async function POST(request: Request) {
  try {
    const { slideContent, courseId, topicId, topicName } = await request.json();

    if (!slideContent && !topicName) {
      return Response.json(
        { error: 'Slide content or topic name is required' },
        { status: 400 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return Response.json(
        { error: 'OpenAI API key not configured' },
        { status: 500 }
      );
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const contentLen = slideContent?.length ?? 0;
    const questionTarget = slideContent ? targetQuestionCount(contentLen) : 10;
    const sampledContent = slideContent ? sampleContent(slideContent, 40000) : '';

    let prompt: string;

    // Shared guidance on question *style* — independent of answer format.
    // A meaningful share of every batch should be scenario-based: a short,
    // realistic situation the student must reason through, not just a
    // dressed-up definition lookup.
    const scenarioGuidance = `
Vary the question STYLE, not just the answer format. Use a mix of:
- Recall/definition: tests knowledge of a term, fact, or formula directly.
- Conceptual/applied: tests understanding by asking "why" or "how" something works.
- Scenario-based: opens with a brief, concrete, realistic situation (2–3
  sentences — a workplace task, a dataset, a piece of code, a system
  behaving a certain way, a student/professional facing a decision) built
  from specifics in the material, then asks what the correct action,
  outcome, or diagnosis is. It should read like a mini case, not a
  definition with a scenario label glued on.

At least 30–40% of the questions in this batch must be genuine
scenario-based questions. Mark each question with "is_scenario": true or
false so reviewers can tell at a glance. Scenario questions can use any of
the answer formats below (single_choice, multiple_choice, or
fill_in_blank) — the format is independent of the style.`;

    if (topicName && !slideContent) {
      // Topic-only mode: generate without slides
      prompt = `You are an expert exam question generator for university courses. Generate a comprehensive set of exam-style questions for the topic: "${topicName}".

Generate at least 10 questions covering different aspects of this topic. Mix answer formats naturally:
- single_choice: one correct answer from 4 options
- multiple_choice: 2–3 correct answers from 4 options
- fill_in_blank: a short answer that completes a sentence
${scenarioGuidance}

For every question:
1. Test understanding of the topic, not just memorization
2. Write clear, unambiguous options
3. Include a brief explanation of the correct answer
4. Assign an appropriate difficulty (easy, medium, hard)
5. Cover foundational concepts, applied knowledge, edge cases, and realistic scenarios

Respond with a JSON object in this exact format:
{
  "questions": [
    {
      "question_text": "The question text here",
      "question_type": "single_choice" | "multiple_choice" | "fill_in_blank",
      "options": ["Option A", "Option B", "Option C", "Option D"] | null,
      "correct_answer": "Option A" | ["Option A", "Option C"] | "answer text",
      "explanation": "Brief explanation",
      "difficulty": "easy" | "medium" | "hard",
      "is_scenario": true | false
    }
  ]
}

Rules:
- single_choice: correct_answer is a string matching one option exactly
- multiple_choice: correct_answer is an array of strings matching correct options exactly
- fill_in_blank: options is null, correct_answer is the fill-in text`;
    } else {
      // Slide-content mode (topic is optional extra context)
      const topicContext = topicName ? `\nFocus specifically on the topic: "${topicName}"\n` : '';
      prompt = `You are an expert exam question generator for university courses. Analyse the lecture content below and generate exactly ${questionTarget} exam-style questions that comprehensively cover the material.
${topicContext}
Mix answer formats naturally:
- single_choice: one correct answer from 4 options
- multiple_choice: 2–3 correct answers from 4 options
- fill_in_blank: a short answer that completes a sentence
${scenarioGuidance}

For every question:
1. Test understanding, not just memorization
2. Write clear, unambiguous options
3. Include a brief explanation of the correct answer
4. Assign an appropriate difficulty (easy, medium, hard)
5. Spread questions evenly across the full document — beginning, middle, and end
6. Ground scenario questions in specifics actually present in the content
   below (its examples, procedures, data, or terminology) rather than
   generic filler — extract the concrete detail, then build the situation
   around it

LECTURE CONTENT:
${sampledContent}

Respond with a JSON object in this exact format:
{
  "questions": [
    {
      "question_text": "The question text here",
      "question_type": "single_choice" | "multiple_choice" | "fill_in_blank",
      "options": ["Option A", "Option B", "Option C", "Option D"] | null,
      "correct_answer": "Option A" | ["Option A", "Option C"] | "answer text",
      "explanation": "Brief explanation",
      "difficulty": "easy" | "medium" | "hard",
      "is_scenario": true | false
    }
  ]
}

Rules:
- single_choice: correct_answer is a string matching one option exactly
- multiple_choice: correct_answer is an array of strings matching correct options exactly
- fill_in_blank: options is null, correct_answer is the fill-in text
- Cover every key point — do not skip any`;
    }

    const completion = await withOpenAIRetry(() => openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are an expert educational content creator specializing in creating exam questions from lecture materials. Always respond with valid JSON.',
        },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: 16000,
    }));

    logAiUsage('generate_questions', 'gpt-4o', completion.usage).catch(() => {});

    const responseContent = completion.choices[0].message.content;
    if (!responseContent) throw new Error('No response from OpenAI');

    const parsedResponse = JSON.parse(responseContent);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const validatedQuestions = parsedResponse.questions.map((q: any) => ({
      question_text: q.question_text,
      question_type: q.question_type,
      options: q.options || null,
      correct_answer: q.correct_answer,
      explanation: q.explanation || '',
      difficulty: q.difficulty || 'medium',
      is_scenario: !!q.is_scenario,
    }));

    return Response.json({ questions: validatedQuestions });
  } catch (error: unknown) {
    console.error('Error generating questions:', error);

    if ((error as { code?: string })?.code === 'insufficient_quota') {
      return Response.json(
        { error: 'OpenAI API quota exceeded. Please check your billing.' },
        { status: 402 }
      );
    }

    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to generate questions' },
      { status: 500 }
    );
  }
}

