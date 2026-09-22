import { createClient } from '@/lib/supabase/server';
import { isAdminRole } from '@/lib/utils';

/**
 * Verifies the request's session belongs to an admin (or super admin)
 * before an API route does anything privileged. Several admin routes
 * used the service-role client directly with no check at all — the
 * client-side /admin layout guard only protects page navigation, not
 * the API routes themselves, so anyone who knew the URL could call
 * them unauthenticated. Every admin route should call this (or
 * requireSuperAdmin below) first.
 *
 * Returns the caller's user id on success, or a Response to return
 * immediately on failure — callers do:
 *   const auth = await requireAdmin();
 *   if (auth instanceof Response) return auth;
 */
export async function requireAdmin(): Promise<{ userId: string } | Response> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single();

  if (!isAdminRole(profile?.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  return { userId: user.id };
}

/** Same as requireAdmin, but for super-admin-only routes (the Tracker) —
 * a regular admin is Forbidden here even though they pass requireAdmin. */
export async function requireSuperAdmin(): Promise<{ userId: string } | Response> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'super_admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  return { userId: user.id };
}
