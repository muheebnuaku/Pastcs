import OpenAI from 'openai';

export const maxDuration = 60;

const SYSTEM_PROMPT = `You are an expert university professor and passionate teacher. You create comprehensive, beginner-friendly lessons that make complex topics easy to understand.

Your teaching style:
- Speak directly to the student using "you" and "we"
- Start with the simplest ideas, then build up gradually
- Use relatable real-world analogies and comparisons
- Be warm, encouraging, and clear
- Make the student feel they CAN understand this topic`;

const LESSON_PROMPT = `Create a comprehensive, structured lesson from the document content below. The student may be a complete beginner, so explain everything from scratch.

Use EXACTLY these section headings (with ## prefix):

## Introduction
What this topic is about, why it matters, and what the student will learn by the end. Speak directly to the student. Be engaging and motivating.

## Key Concepts
List and clearly define every important term and idea from the content. Use simple language. For each concept, give a one-sentence plain-English explanation.

## Full Explanation
A thorough, step-by-step walkthrough of all the content. Use analogies. Break down complex ideas. This should cover everything in the document in detail.

## Real-World Examples
At least 3 concrete, practical examples showing how these concepts work in the real world. Make them relatable.

## Practice Review
5 review questions that test understanding of the main points. After each question, provide the answer. Mix easy recall questions with deeper thinking questions.

## Summary
The 6 most important things the student must remember from this lesson. Use bullet points. Keep each point to one clear sentence.

---

Document Content:
{CONTENT}`;

export async function POST(req: Request) {
  try {
    const { text, context } = await req.json() as { text: string; context?: string };
    if (!text?.trim()) {
      return Response.json({ error: 'No document content provided' }, { status: 400 });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const userMessage = LESSON_PROMPT.replace('{CONTENT}', text.slice(0, 8000)) +
      (context ? `\n\nCourse context: ${context}` : '');

    const stream = openai.chat.completions.stream({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.7,
      max_tokens: 4000,
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
