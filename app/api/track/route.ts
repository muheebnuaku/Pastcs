import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

export async function POST(req: Request) {
  try {
    const { event, metadata } = await req.json() as { event: string; metadata?: Record<string, unknown> };
    if (!event) return new Response(null, { status: 204 });

    // Get the authenticated user from the session
    const serverClient = await createServerClient();
    const { data: { user } } = await serverClient.auth.getUser();

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    await supabase.from('feature_events').insert({
      user_id: user?.id ?? null,
      event,
      metadata: metadata ?? {},
    });

    return new Response(null, { status: 204 });
  } catch {
    // Silently fail — table may not exist yet
    return new Response(null, { status: 204 });
  }
}
