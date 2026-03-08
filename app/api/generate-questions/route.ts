import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: Request) {
  try {
    const { slideContent, courseId, topicId } = await request.json();

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

    const prompt = `You are an expert exam question generator for university courses. Based on the following lecture slide content, generate exactly 10 exam-style questions:
- 5 single choice questions (4 options each, one correct answer)
- 3 multiple choice questions (4 options each, 2-3 correct answers)
- 2 fill in the blank questions

For each question:
1. Make it educational and test understanding, not just memorization
2. Provide clear, unambiguous options
3. Include a brief explanation of why the answer is correct
4. Assign an appropriate difficulty level (easy, medium, hard)

LECTURE CONTENT:
${slideContent}

Respond with a JSON array of questions in this exact format:
{
  "questions": [
    {
      "question_text": "The question text here",
      "question_type": "single_choice" | "multiple_choice" | "fill_in_blank",
      "options": ["Option A", "Option B", "Option C", "Option D"] | null,
      "correct_answer": "Option A" | ["Option A", "Option C"] | "answer text",
      "explanation": "Brief explanation of the correct answer",
      "difficulty": "easy" | "medium" | "hard"
    }
  ]
}

Important:
- For single_choice, correct_answer is a string matching one option
- For multiple_choice, correct_answer is an array of strings matching correct options
- For fill_in_blank, options is null and correct_answer is the text that fills the blank
- Make sure the questions cover different aspects of the content
- Vary the difficulty levels appropriately`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
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
      max_tokens: 4000,
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
