import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  const { courseId, topicName } = await req.json();

  if (!courseId || !topicName?.trim()) {
    return Response.json({ error: 'courseId and topicName required' }, { status: 400 });
  }

  const name = topicName.trim();

  // Return existing topic if found (case-insensitive)
  const { data: existing } = await supabaseAdmin
    .from('topics')
    .select('id, topic_name')
    .eq('course_id', courseId)
    .ilike('topic_name', name)
    .maybeSingle();

  if (existing) {
    return Response.json({ topicId: existing.id, created: false });
  }

  // Get next order_index
  const { data: topicsData } = await supabaseAdmin
    .from('topics')
    .select('order_index')
    .eq('course_id', courseId)
    .order('order_index', { ascending: false })
    .limit(1);

  const nextOrder = (topicsData?.[0]?.order_index ?? 0) + 1;

  const { data: newTopic, error } = await supabaseAdmin
    .from('topics')
    .insert({ course_id: courseId, topic_name: name, order_index: nextOrder })
    .select('id')
    .single();

  if (error || !newTopic) {
    return Response.json({ error: 'Failed to create topic' }, { status: 500 });
  }

  return Response.json({ topicId: newTopic.id, created: true });
}
