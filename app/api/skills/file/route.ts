import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { ACCESS_TOKEN, SKILL_SLUG } from '@/lib/skills';

// Downloads a skill course's sample project (a zip in the private
// skill-files bucket). The database decides who may have it: anyone if
// the admin made it public, otherwise a buyer, by their account or by the
// token in their access link. The file itself goes out through a link
// that works for two minutes.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get('slug') ?? '';
  const access = url.searchParams.get('access');
  if (!SKILL_SLUG.test(slug) || (access && !ACCESS_TOKEN.test(access))) {
    return Response.json({ error: 'Bad request' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const admin = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await admin.rpc('skill_file_for', { p_slug: slug, p_user: user?.id ?? null, p_token: access || null });
  if (error) {
    console.error('[skills/file] skill_file_for failed', error.message);
    return Response.json({ error: 'Could not get the file. Please try again.' }, { status: 500 });
  }
  const row = (Array.isArray(data) ? data[0] : data) as { path: string; file_name: string } | undefined;
  if (!row) return Response.json({ error: 'This file is for students on the course.' }, { status: 403 });

  const { data: signed, error: signErr } = await admin.storage.from('skill-files').createSignedUrl(row.path, 120, { download: row.file_name });
  if (signErr || !signed?.signedUrl) {
    console.error('[skills/file] signing failed', signErr?.message);
    return Response.json({ error: 'Could not get the file. Please try again.' }, { status: 500 });
  }
  return Response.redirect(signed.signedUrl, 302);
}
