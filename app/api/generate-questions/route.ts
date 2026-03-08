import OpenAI from 'openai';

export async function POST(request: Request) {
  try {
    const { slideContent, courseId } = await request.json();

    if (!slideContent) {
      return Response.json(
        { error: 'Slide content is required' },
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

    const prompt = `You are an expert exam question generator for university courses. Analyse the lecture slide content below and generate one exam-style question for EVERY distinct key point, concept, definition, formula, or fact you find. Do not set a limit — the number of questions should equal the number of key points in the content.

Mix question types naturally based on what suits each point:
- single_choice: one correct answer from 4 options
- multiple_choice: 2–3 correct answers from 4 options
- fill_in_blank: a short answer that completes a sentence

For every question:
1. Test understanding, not just memorization
2. Write clear, unambiguous options
3. Include a brief explanation of the correct answer
4. Assign an appropriate difficulty (easy, medium, hard)

LECTURE CONTENT:
${slideContent}

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

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are an expert educational content creator specializing in creating exam questions from lecture materials. Always respond with valid JSON.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: 16000,
    });

    const responseContent = completion.choices[0].message.content;
    
    if (!responseContent) {
      throw new Error('No response from OpenAI');
    }

    const parsedResponse = JSON.parse(responseContent);

    // Validate and clean the questions
    const validatedQuestions = parsedResponse.questions.map((q: any) => ({
      question_text: q.question_text,
      question_type: q.question_type,
      options: q.options || null,
      correct_answer: q.correct_answer,
      explanation: q.explanation || '',
      difficulty: q.difficulty || 'medium',
    }));

    return Response.json({ questions: validatedQuestions });
  } catch (error: any) {
    console.error('Error generating questions:', error);
    
    if (error?.code === 'insufficient_quota') {
      return Response.json(
        { error: 'OpenAI API quota exceeded. Please check your billing.' },
        { status: 402 }
      );
    }

    return Response.json(
      { error: error.message || 'Failed to generate questions' },
      { status: 500 }
    );
  }
}
