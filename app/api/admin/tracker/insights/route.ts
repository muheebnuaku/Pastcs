import OpenAI from 'openai';
import { requireSuperAdmin } from '@/lib/adminAuth';
import { withOpenAIRetry } from '@/lib/openaiRetry';
import { logAiUsage } from '@/lib/aiUsage';

interface TrackerTotals {
  revenue: number;
  courseRevenue: number;
  tutorRevenue: number;
  courseSubCount: number;
  tutorCreditCount: number;
  freePassCount: number;
}

// POST /api/admin/tracker/insights — takes the same aggregated numbers
// the Tracker page already shows and asks GPT for a short written read
// on what they mean, so a super admin gets "here's what's actually
// happening and why" instead of just a wall of stat tiles. Deliberately
// takes the already-computed totals rather than re-querying the DB
// itself — one round trip, and it can never disagree with what's on
// screen.
export async function POST(request: Request) {
  const auth = await requireSuperAdmin();
  if (auth instanceof Response) return auth;

  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ error: 'OpenAI API key not configured' }, { status: 500 });
  }

  try {
    const body = await request.json() as {
      totals: TrackerTotals;
      revenueByDay: { date: string; course: number; tutor: number }[];
      courseRevenueByLevel: { level: number; revenue: number; count: number }[];
      tutorRevenueByPlan: { plan: string; planName: string; revenue: number; count: number }[];
    };

    const toGHC = (pesewas: number) => (pesewas / 100).toFixed(2);

    const last7 = body.revenueByDay.slice(-7);
    const prev7 = body.revenueByDay.slice(-14, -7);
    const sum = (rows: { course: number; tutor: number }[]) =>
      rows.reduce((s, r) => s + r.course + r.tutor, 0);
    const last7Total = sum(last7);
    const prev7Total = sum(prev7);

    const prompt = `You're analyzing revenue data for PastCS, an exam-prep platform selling two things: course access subscriptions (by academic level) and AI Tutor credit packs. All amounts below are in Ghanaian pesewas (divide by 100 for GHC).

TOTALS (all-time):
- Total revenue: GHC ${toGHC(body.totals.revenue)}
- Course access revenue: GHC ${toGHC(body.totals.courseRevenue)} (${body.totals.courseSubCount} paid subscriptions)
- AI Tutor credit revenue: GHC ${toGHC(body.totals.tutorRevenue)} (${body.totals.tutorCreditCount} packs sold)
- Free passes granted (not revenue): ${body.totals.freePassCount}

LAST 7 DAYS vs PRIOR 7 DAYS:
- Last 7 days: GHC ${toGHC(last7Total)}
- Prior 7 days: GHC ${toGHC(prev7Total)}

REVENUE BY LEVEL (course access):
${body.courseRevenueByLevel.map(l => `- Level ${l.level}: GHC ${toGHC(l.revenue)} (${l.count} subs)`).join('\n') || '(none yet)'}

REVENUE BY AI TUTOR PLAN:
${body.tutorRevenueByPlan.map(p => `- ${p.planName}: GHC ${toGHC(p.revenue)} (${p.count} sold)`).join('\n') || '(none yet)'}

Write a short, direct analysis for the founder (2-4 short paragraphs, plain text, no markdown headers). Cover: (1) what's actually driving revenue right now — which product, which level/plan; (2) whether the week-over-week trend is meaningfully up, down, or flat, and what that could mean; (3) one or two concrete, specific things worth considering next (e.g. a level or plan that's underperforming and might need a price/marketing look, or one that's clearly working and worth doubling down on). Be honest if the data is too thin to conclude much — don't invent confidence that isn't there. No generic filler like "continue monitoring performance".`;

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await withOpenAIRetry(() => openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
      temperature: 0.4,
    }));

    logAiUsage('tracker_insights', 'gpt-4o', completion.usage, auth.userId).catch(() => {});

    const insight = completion.choices[0]?.message?.content?.trim() || '';
    return Response.json({ insight });
  } catch (err) {
    console.error('Tracker insights error:', err);
    return Response.json({ error: 'Failed to generate insights' }, { status: 500 });
  }
}
