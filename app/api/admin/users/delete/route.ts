import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/adminAuth';
import { logAudit } from '@/lib/auditLog';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// POST /api/admin/users/delete { ids } — permanently deletes accounts
// (up to 100 at once, e.g. a batch of spam sign-ups). Deleting the auth
// user removes their profile and everything that hangs off it. Each one
// is checked in the database first (admin_delete_blocker, migration 049):
// never the admin themselves, another admin, anyone who has paid, or a
// Level Rep with commission on record. Those are skipped with a reason;
// suspend them instead.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REASONS: Record<string, string> = {
  not_found: 'Already deleted.',
  self: 'You can’t delete your own account.',
  admin_account: 'Admin accounts can’t be deleted here.',
  has_payments: 'Has paid. Payment records must be kept, so suspend this account instead.',
  rep_records: 'Has Level Rep commission on record. Suspend this account instead.',
};

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const { ids } = await req.json().catch(() => ({})) as { ids?: unknown };
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100 || !ids.every(id => typeof id === 'string' && UUID.test(id))) {
    return Response.json({ error: 'Send between 1 and 100 account ids.' }, { status: 400 });
  }

  const deleted: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const id of [...new Set(ids as string[])]) {
    const { data: blocker, error: checkError } = await supabaseAdmin.rpc('admin_delete_blocker', { p_actor: auth.userId, p_user: id });
    if (checkError) {
      const missing = /admin_delete_blocker|Could not find the function/.test(checkError.message);
      skipped.push({ id, reason: missing ? 'Run migration 049 in Supabase first.' : 'Couldn’t check this account. Try again.' });
      continue;
    }
    if (blocker) { skipped.push({ id, reason: REASONS[blocker as string] ?? 'Can’t be deleted.' }); continue; }

    const { data: target } = await supabaseAdmin.from('users').select('email, full_name').eq('id', id).maybeSingle();
    const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
    if (error) { skipped.push({ id, reason: error.message }); continue; }
    deleted.push(id);
    logAudit(supabaseAdmin, 'user.delete', target?.email ?? id, { userId: id, name: target?.full_name ?? null }, auth.userId).catch(() => {});
  }

  return Response.json({ deleted, skipped });
}
