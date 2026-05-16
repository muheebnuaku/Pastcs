import OpenAI from 'openai';

// Scale question count: ~1 question per 1000 chars, capped at 50
function targetQuestionCount(contentLength: number): number {
  if (contentLength >= 80000) return 50;
  if (contentLength >= 50000) return 40;
  if (contentLength >= 30000) return 30;
  if (contentLength >= 15000) return 20;
  if (contentLength >= 5000)  return 15;
  return 10;
}

// For very large documents, sample intelligently: start + middle + end
function sampleContent(text: string, maxChars = 40000): string {
  if (text.length <= maxChars) return text;
  const third = Math.floor(maxChars / 3);
  const start  = text.slice(0, third);
  const mid    = text.slice(Math.floor(text.length / 2) - Math.floor(third / 2), Math.floor(text.length / 2) + Math.floor(third / 2));
  const end    = text.slice(-third);
  return `${start}\n\n[...middle section...]\n\n${mid}\n\n[...end section...]\n\n${end}`;
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
    const sampledContent = slideContent ? sampleContent(slideContent) : '';

    let prompt: string;

    if (topicName && !slideContent) {
      // Topic-only mode: generate without slides
      prompt = `You are an expert exam question generator for university courses. Generate a comprehensive set of exam-style questions for the topic: "${topicName}".

Generate at least 10 questions covering different aspects of this topic. Mix question types naturally:
- single_choice: one correct answer from 4 options
- multiple_choice: 2–3 correct answers from 4 options
- fill_in_blank: a short answer that completes a sentence

For every question:
1. Test understanding of the topic, not just memorization
2. Write clear, unambiguous options
3. Include a brief explanation of the correct answer
4. Assign an appropriate difficulty (easy, medium, hard)
5. Cover foundational concepts, applied knowledge, and edge cases

Respond with a JSON object in this exact format:
{
  "questions": [
    {
      "question_text": "The question text here",
      "question_type": "single_choice" | "multiple_choice" | "fill_in_blank",
      "options": ["Option A", "Option B", "Option C", "Option D"] | null,
      "correct_answer": "Option A" | ["Option A", "Option C"] | "answer text",
      "explanation": "Brief explanation",
      "difficulty": "easy" | "medium" | "hard"
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
Mix question types naturally:
- single_choice: one correct answer from 4 options
- multiple_choice: 2–3 correct answers from 4 options
- fill_in_blank: a short answer that completes a sentence

For every question:
1. Test understanding, not just memorization
2. Write clear, unambiguous options
3. Include a brief explanation of the correct answer
4. Assign an appropriate difficulty (easy, medium, hard)
5. Spread questions evenly across the full document — beginning, middle, and end

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
      "difficulty": "easy" | "medium" | "hard"
    }
  ]
}

Rules:
- single_choice: correct_answer is a string matching one option exactly
- multiple_choice: correct_answer is an array of strings matching correct options exactly
- fill_in_blank: options is null, correct_answer is the fill-in text
- Cover every key point — do not skip any`;
    }

    const completion = await openai.chat.completions.create({
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
    });

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

