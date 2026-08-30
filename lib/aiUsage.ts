import { createClient } from '@supabase/supabase-js';

interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

/**
 * Records token usage for one AI call so spend across all six AI
 * features is actually visible to admins (see admin's AI usage view) —
 * previously nothing tracked this anywhere. Fire-and-forget: a logging
 * failure, or the table not existing yet on a fresh environment, must
 * never affect the feature it's measuring.
 */
export async function logAiUsage(
  feature: string,
  model: string,
  usage: Usage | null | undefined,
  userId?: string | null
): Promise<void> {
  if (!usage) return;
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    await supabase.from('ai_usage_log').insert({
      user_id: userId ?? null,
      feature,
      model,
      prompt_tokens: usage.prompt_tokens ?? 0,
      completion_tokens: usage.completion_tokens ?? 0,
      total_tokens: usage.total_tokens ?? 0,
    });
  } catch {
    // ai_usage_log may not be migrated on this environment yet — non-critical
  }
}
