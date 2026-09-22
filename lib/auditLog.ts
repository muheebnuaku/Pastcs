// Deliberately structural rather than importing SupabaseClient — the
// browser client (@supabase/ssr) and the service-role admin client
// (@supabase/supabase-js) resolve to incompatible generic instantiations
// even though both expose the same .from().insert() shape this needs.
interface MinimalSupabaseClient {
  from(table: string): {
    insert(values: Record<string, unknown>): PromiseLike<{ error: unknown }>;
  };
}

/**
 * Records one high-value admin action (course/question delete, price
 * change, free-pass grant/revoke, program delete) to admin_audit_log —
 * viewable only by super admins. Works with either the browser client
 * (actor_id defaults to auth.uid() via RLS-checked insert) or a
 * service-role client from a server route (actor_id passed explicitly,
 * since a service-role insert has no session to default from).
 * Fire-and-forget: a logging failure must never block the action itself.
 */
export async function logAudit(
  supabase: MinimalSupabaseClient,
  action: string,
  target: string,
  metadata?: Record<string, unknown>,
  actorId?: string | null
): Promise<void> {
  try {
    await supabase.from('admin_audit_log').insert({
      ...(actorId ? { actor_id: actorId } : {}),
      action,
      target,
      metadata: metadata ?? {},
    });
  } catch {
    // admin_audit_log may not be migrated on this environment yet — non-critical
  }
}
